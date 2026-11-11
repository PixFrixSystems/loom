// Plan limits (5-hour and weekly), read the way Claude Code's /usage reads them.
// The SDK call is marked experimental, so every failure here is quiet and the last reading stays.

import type { WebContents } from 'electron'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { LoomSettings, UsageLimit, UsageSnapshot } from '@shared/types'

type UsageResponse = Awaited<ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>>

interface RawWindow {
  utilization: number | null
  resets_at: string | null
}

interface RawLimit {
  kind: string
  group?: string
  percent: number
  severity?: string
  resets_at?: string | null
  is_active?: boolean
  scope?: { model?: { display_name?: string | null } | null } | null
}

const CLAUDE_DIR = join(homedir(), '.claude')

function stopLine(): number | null {
  try {
    const v = Number(JSON.parse(readFileSync(join(CLAUDE_DIR, 'usage-guard.json'), 'utf8')).weeklyStopAt)
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return existsSync(join(CLAUDE_DIR, 'hooks', 'usage-guard.mjs')) ? 80 : null
  }
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function severityOf(s: string | undefined, percent: number): UsageLimit['severity'] {
  if (s === 'critical' || s === 'exceeded' || percent >= 95) return 'critical'
  if (s === 'warning' || percent >= 80) return 'warning'
  return 'normal'
}

function labelFor(l: RawLimit): string {
  const model = l.scope?.model?.display_name
  if (l.kind === 'weekly_all') return 'Week'
  if (l.group === 'weekly' || l.kind.startsWith('weekly')) return model ? `${model} week` : 'Week'
  if (l.group === 'session' || /five|session|hour/.test(l.kind)) return model ? `${model} 5h` : '5h'
  return model ? `${model} ${l.kind.replace(/_/g, ' ')}` : l.kind.replace(/_/g, ' ')
}

function normalize(r: UsageResponse): UsageSnapshot {
  const rl = (r.rate_limits ?? null) as (Record<string, unknown> & { limits?: RawLimit[] }) | null
  const limits: UsageLimit[] = []
  if (rl?.limits?.length) {
    for (const l of rl.limits) {
      if (typeof l.percent !== 'number') continue
      limits.push({
        key: `${l.kind}:${l.scope?.model?.display_name ?? ''}`,
        label: labelFor(l),
        percent: l.percent,
        resetsAt: toMs(l.resets_at),
        severity: severityOf(l.severity, l.percent),
        active: l.is_active !== false
      })
    }
  }
  const five = rl?.five_hour as RawWindow | null | undefined
  if (five && typeof five.utilization === 'number' && !limits.some((l) => l.label === '5h')) {
    limits.unshift({ key: 'five_hour', label: '5h', percent: five.utilization, resetsAt: toMs(five.resets_at), severity: severityOf(undefined, five.utilization), active: true })
  }
  const week = rl?.seven_day as RawWindow | null | undefined
  if (week && typeof week.utilization === 'number' && !limits.some((l) => l.label === 'Week')) {
    limits.push({ key: 'seven_day', label: 'Week', percent: week.utilization, resetsAt: toMs(week.resets_at), severity: severityOf(undefined, week.utilization), active: true })
  }
  return { at: Date.now(), plan: r.subscription_type ?? null, available: r.rate_limits_available, limits, stopAt: stopLine() }
}

/** Keeps the user's usage guard fed: it reads ~/.claude/usage-cache.json, which normally only the terminal status line writes. */
async function feedGuard(snap: UsageSnapshot): Promise<void> {
  const cache = join(CLAUDE_DIR, 'usage-cache.json')
  if (!existsSync(cache) && !existsSync(join(CLAUDE_DIR, 'hooks', 'usage-guard.mjs'))) return
  const week = snap.limits.find((l) => l.label === 'Week')
  if (!week) return
  const five = snap.limits.find((l) => l.label === '5h')
  const entry = {
    seven_day: { used_percentage: week.percent, resets_at: week.resetsAt ? Math.floor(week.resetsAt / 1000) : null },
    five_hour: five ? { used_percentage: five.percent, resets_at: five.resetsAt ? Math.floor(five.resetsAt / 1000) : null } : null,
    updated_at: Math.floor(snap.at / 1000)
  }
  try {
    const tmp = `${cache}.loom.tmp`
    await fs.writeFile(tmp, JSON.stringify(entry))
    await fs.rename(tmp, cache)
  } catch {
    // never let the meter break anything
  }
}

let last: UsageSnapshot | null = null
let inflight: Promise<UsageSnapshot | null> | null = null
let lastFetch = 0

export function lastUsage(): UsageSnapshot | null {
  return last
}

/**
 * Asks Claude Code for the limits. Uses a running chat when there is one; otherwise starts an idle
 * Claude process that sends nothing to the model, asks, and closes.
 */
export function refreshUsage(
  web: WebContents | null,
  deps: {
    sdk: () => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>
    liveQuery: () => Query | null
    executable: (s: LoomSettings) => string | undefined
    settings: () => LoomSettings
  },
  force = false
): Promise<UsageSnapshot | null> {
  if (inflight) return inflight
  if (!force && last && Date.now() - lastFetch < 45_000) return Promise.resolve(last)
  lastFetch = Date.now()
  inflight = (async () => {
    let response: UsageResponse | null = null
    try {
      const live = deps.liveQuery()
      if (live) {
        response = await live.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      } else {
        const sdk = await deps.sdk()
        let release: ((r: IteratorResult<never>) => void) | null = null
        const idle: AsyncIterable<never> = {
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>((r) => (release = r)) })
        }
        const abort = new AbortController()
        const q = sdk.query({
          prompt: idle,
          options: {
            cwd: homedir(),
            persistSession: false,
            settingSources: [],
            abortController: abort,
            pathToClaudeCodeExecutable: deps.executable(deps.settings())
          }
        })
        try {
          await q.initializationResult()
          response = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        } finally {
          try {
            q.close()
          } catch {
            // already gone
          }
          abort.abort()
          ;(release as ((r: IteratorResult<never>) => void) | null)?.({ done: true, value: undefined as never })
        }
      }
    } catch (e) {
      const snap: UsageSnapshot = last ? { ...last, error: (e as Error).message } : { at: Date.now(), plan: null, available: false, limits: [], stopAt: stopLine(), error: (e as Error).message }
      if (web && !web.isDestroyed()) web.send('usage:update', snap)
      return last
    }
    if (!response) return last
    last = normalize(response)
    void feedGuard(last)
    if (web && !web.isDestroyed()) web.send('usage:update', last)
    return last
  })().finally(() => {
    inflight = null
  })
  return inflight
}
