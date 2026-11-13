import { BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AuthStatus, LoginState, UsageLimit, UsageSnapshot } from '@shared/types'
import { agentProfile, externalBrand } from './externalAgent'
import { ExternalProtocol } from './externalProtocol'

const LOGIN_TIMEOUT_MS = 10 * 60_000
const USAGE_CACHE_MS = 60_000

interface LoginRun {
  client: ExternalProtocol
  loginId?: string
  earlyResult?: { id: string; success: boolean; error?: string }
  timer: NodeJS.Timeout
  onDone: () => void
}

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

interface RateLimits {
  planType?: string | null
  primary?: RateLimitWindow | null
  secondary?: RateLimitWindow | null
}

let current: LoginRun | undefined
let state: LoginState = { status: 'idle' }
let usageCache: { program: string; at: number; pending: boolean; result: Promise<UsageSnapshot | null> } | undefined

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setState(next: LoginState): void {
  state = next
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send('external:login:changed', state)
  }
}

function finish(run: LoginRun, result: LoginState): void {
  if (current !== run) return
  current = undefined
  clearTimeout(run.timer)
  run.client.close()
  setState(result)
  if (result.status === 'done') run.onDone()
}

function complete(run: LoginRun, success: boolean, error?: string): void {
  finish(run, success ? { status: 'done' } : { status: 'failed', message: error || 'The browser sign-in did not complete.' })
}

async function request<T>(program: string, method: string, params?: object): Promise<T> {
  const client = new ExternalProtocol(program, { cwd: homedir() })
  try {
    return await client.request<T>(method, params)
  } finally {
    client.close()
  }
}

export async function externalAuthStatus(program: string): Promise<AuthStatus> {
  if (!program || !existsSync(program)) return { loggedIn: false, missing: true }
  try {
    const result = await request<{
      account: { email?: string; planType?: string; type?: string } | null
      requiresOpenaiAuth?: boolean
    }>(program, 'account/read', { refreshToken: false })
    const account = result.account
    return account
      ? { loggedIn: true, email: account.email, plan: account.planType, method: account.type === agentProfile.loginType ? externalBrand.accountName : account.type }
      : { loggedIn: false, requiresSignIn: result.requiresOpenaiAuth }
  } catch (error) {
    return { loggedIn: false, error: message(error) }
  }
}

export function clearExternalUsage(): void {
  usageCache = undefined
}

export function externalUsage(program: string, force = false): Promise<UsageSnapshot | null> {
  if (!program || !existsSync(program)) return Promise.resolve(null)
  if (usageCache?.program === program && (usageCache.pending || (!force && Date.now() - usageCache.at < USAGE_CACHE_MS))) {
    return usageCache.result
  }
  const result = readUsage(program)
  const entry = { program, at: Date.now(), pending: true, result }
  usageCache = entry
  void result.then(() => { entry.pending = false })
  return result
}

async function readUsage(program: string): Promise<UsageSnapshot | null> {
  try {
    const { rateLimits } = await request<{ rateLimits: RateLimits }>(program, 'account/rateLimits/read')
    const limits = [rateLimits.primary, rateLimits.secondary].flatMap((window, index): UsageLimit[] => {
      if (!window || !Number.isFinite(window.usedPercent)) return []
      const minutes = window.windowDurationMins ?? 0
      let label = index === 0 ? 'Session' : 'Period'
      if (minutes === 7 * 1440) label = 'Week'
      else if (minutes >= 1440) label = `${Math.round(minutes / 1440)}d`
      else if (minutes >= 60) label = `${Math.round(minutes / 60)}h`
      else if (minutes > 0) label = `${minutes}m`
      const percent = Math.min(100, Math.max(0, window.usedPercent))
      return [{ key: `window-${index}`, label, percent, resetsAt: window.resetsAt ? window.resetsAt * 1000 : null, severity: percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'normal', active: true }]
    })
    return { at: Date.now(), plan: rateLimits.planType ?? null, available: limits.length > 0, limits, stopAt: null }
  } catch {
    return null
  }
}

export function startExternalLogin(program: string, onDone: () => void): LoginState {
  if (current) return state
  if (!externalBrand.loginSupported) return { status: 'failed', message: 'Sign in from the agent’s CLI.' }
  let run: LoginRun
  try {
    const client = new ExternalProtocol(program, {
      cwd: homedir(),
      onNotification: (method, params) => {
        if (current !== run || method !== 'account/login/completed' || typeof params.loginId !== 'string') return
        const success = params.success === true
        const error = typeof params.error === 'string' ? params.error : undefined
        if (!run.loginId) run.earlyResult = { id: params.loginId, success, error }
        else if (run.loginId === params.loginId) complete(run, success, error)
      },
      onClose: (error) => finish(run, { status: 'failed', message: error.message })
    })
    const timer = setTimeout(() => cancelExternalLogin({ status: 'failed', message: 'Sign-in timed out. Try again.' }), LOGIN_TIMEOUT_MS)
    timer.unref()
    run = { client, timer, onDone }
  } catch (error) {
    setState({ status: 'failed', message: message(error) })
    return state
  }
  current = run
  setState({ status: 'waiting' })
  void run.client.request<{ loginId?: string; authUrl?: string }>('account/login/start', { type: agentProfile.loginType }).then((result) => {
    if (current !== run) return
    if (!result.loginId || !result.authUrl) throw new Error('The agent did not return a browser sign-in link.')
    run.loginId = result.loginId
    if (run.earlyResult?.id === run.loginId) {
      complete(run, run.earlyResult.success, run.earlyResult.error)
      return
    }
    const url = new URL(result.authUrl)
    if (url.protocol !== 'https:' || url.username || url.password || !agentProfile.loginOrigins?.includes(url.origin)) {
      throw new Error('The agent returned an unexpected sign-in address.')
    }
    setState({ status: 'waiting', url: url.href })
    void shell.openExternal(url.href).catch(() => {
      if (current === run) setState({ ...state, message: 'Open the sign-in page using the link below.' })
    })
  }).catch((error) => finish(run, { status: 'failed', message: message(error) }))
  return state
}

export function cancelExternalLogin(next: LoginState = { status: 'idle' }): void {
  const run = current
  current = undefined
  setState(next)
  if (!run) return
  clearTimeout(run.timer)
  if (!run.loginId) {
    run.client.close()
    return
  }
  const close = (): void => run.client.close()
  const timeout = setTimeout(close, 2000)
  timeout.unref()
  void run.client.request('account/login/cancel', { loginId: run.loginId }).catch(() => undefined).finally(() => {
    clearTimeout(timeout)
    close()
  })
}

export async function logoutExternal(program: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await request(program, 'account/logout')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
