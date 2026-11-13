import { CircleArrowUp, GitBranch, RefreshCw, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { UsageLimit, UsageSnapshot } from '@shared/types'
import { timeAgo } from '../lib/paths'
import { chatWorking, modelName, useStore } from '../store'
import { MODE_OPTIONS } from './Composer'
import { ProjectMark } from './ProjectMark'
import { ServersStatus } from './Servers'

function level(l: UsageLimit, stopAt: number | null): 'ok' | 'warn' | 'stop' {
  if (l.label === 'Week' && stopAt) {
    if (l.percent >= stopAt) return 'stop'
    if (l.percent >= stopAt - 10) return 'warn'
  }
  if (l.severity === 'critical') return 'stop'
  if (l.severity === 'warning') return 'warn'
  return 'ok'
}

/** The model a weekly limit of its own belongs to ("Fable week" is Fable's), else null. */
function modelWeek(l: UsageLimit): string | null {
  return l.label !== 'Week' && l.label.endsWith(' week') ? l.label.slice(0, -' week'.length) : null
}

function resetText(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms)
  const when = d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const hours = Math.round((ms - Date.now()) / 3_600_000)
  const rel = hours < 1 ? 'within the hour' : hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`
  return `Resets ${when}, ${rel}`
}

function Bar({ l, stopAt }: { l: UsageLimit; stopAt: number | null }): ReactNode {
  return (
    <span className={`meter-bar lvl-${level(l, stopAt)}`}>
      <span className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, l.percent))}%` }} />
      {l.label === 'Week' && stopAt ? <span className="meter-stop" style={{ left: `${stopAt}%` }} /> : null}
    </span>
  )
}

function UsagePopover({ usage, anchor, onClose }: { usage: UsageSnapshot; anchor: DOMRect; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.sb-usage')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const right = Math.max(8, window.innerWidth - anchor.right)
  return createPortal(
    <div ref={ref} className="menu usage-pop" style={{ right, bottom: window.innerHeight - anchor.top + 6 }} role="dialog" aria-label="Plan limits">
      <div className="usage-head">
        <span className="usage-title">Plan limits</span>
        {usage.plan ? <span className="usage-plan">{usage.plan[0].toUpperCase() + usage.plan.slice(1)}</span> : null}
      </div>
      {usage.email ? (
        <p className="usage-account selectable" title="The Claude account these limits belong to">
          {usage.email}
        </p>
      ) : null}
      {!usage.available ? (
        <p className="usage-note">Plan limits are not available for this sign-in.</p>
      ) : usage.limits.length ? (
        usage.limits.map((l) => (
          <div key={l.key} className="usage-row">
            <div className="usage-line">
              <span className="usage-label">{l.label === '5h' ? '5-hour session' : l.label === 'Week' ? 'This week' : modelWeek(l) ? `${modelWeek(l)}, this week` : l.label}</span>
              <span className={`usage-pct lvl-${level(l, usage.stopAt)}`}>{Math.round(l.percent)}% used</span>
            </div>
            <Bar l={l} stopAt={usage.stopAt} />
            {l.resetsAt ? <div className="usage-reset">{resetText(l.resetsAt)}</div> : null}
          </div>
        ))
      ) : (
        <p className="usage-note">No limits are counting right now.</p>
      )}
      {usage.stopAt ? <p className="usage-note">Your usage guard stops Claude at {usage.stopAt}% of the week. Loom keeps it supplied with these readings.</p> : null}
      {usage.error ? <p className="usage-note">The last check failed: {usage.error}</p> : null}
      <div className="usage-foot">
        <span>Checked {timeAgo(usage.at)}</span>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await useStore.getState().refreshUsage(true)
            setBusy(false)
          }}
        >
          <RefreshCw className={busy ? 'spin' : undefined} /> Check now
        </button>
      </div>
    </div>,
    document.body
  )
}

function UsageMeters(): ReactNode {
  const usage = useStore((s) => s.usage)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  if (!usage || !usage.available) return null
  // The 5-hour session and the week for all models, then a meter for each model with a weekly limit
  // of its own (Fable, say). Every one is shown: the server marks one row as its headline pick, but
  // the others count all the same, and the week for all models must never drop out.
  const main = usage.limits.filter((l) => l.label === '5h' || l.label === 'Week')
  const models = usage.limits.filter((l) => modelWeek(l))
  const list = main.length || models.length ? [...main, ...models] : usage.limits.slice(0, 2)
  return (
    <>
      <button
        className="sb-usage"
        title="Plan limits"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        {list.length ? (
          list.map((l) => (
            <span key={l.key} className="meter" title={modelWeek(l) ? `${modelWeek(l)} this week: ${Math.round(l.percent)}% used` : undefined}>
              <span className="meter-label">{modelWeek(l) ?? l.label}</span>
              <Bar l={l} stopAt={usage.stopAt} />
              <span className={`meter-pct lvl-${level(l, usage.stopAt)}`}>{Math.round(l.percent)}%</span>
            </span>
          ))
        ) : (
          <span className="meter-label">Limits</span>
        )}
      </button>
      {anchor ? <UsagePopover usage={usage} anchor={anchor} onClose={() => setAnchor(null)} /> : null}
    </>
  )
}

/** Shows once a new version has downloaded, like VS Code's Restart to Update. */
function UpdateButton(): ReactNode {
  const update = useStore((s) => s.update)
  if (update?.state !== 'ready') return null
  return (
    <button
      className="sb-item sb-update"
      title={`Loom ${update.available} has downloaded. Restart to install it; your tabs and chats come back.`}
      onClick={() => void window.loom.updateInstall()}
    >
      <CircleArrowUp />
      Restart to update
    </button>
  )
}

export function StatusBar(): ReactNode {
  const s = useStore()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const project = s.projects.find((p) => p.id === tab?.projectId)
  const git = project ? s.git[project.id] : undefined
  const chat = tab?.kind === 'chat' ? s.chats[tab.id] : undefined
  const running = Object.values(s.chats).filter((c) => chatWorking(c)).length
  const agents = Object.values(s.chats).reduce((n, c) => n + (c.tasks?.length ?? 0), 0)
  const waiting = Object.values(s.chats).filter((c) => c.permissions.length).length

  useEffect(() => {
    if (!project) return
    void s.refreshGit(project.id)
    const t = setInterval(() => {
      if (document.hasFocus()) void useStore.getState().refreshGit(project.id)
    }, 20000)
    return () => clearInterval(t)
  }, [project?.id])

  const mode = tab?.kind === 'chat' ? (tab.permissionMode ?? chat?.permissionMode) : null
  // A phone is using Loom right now: say so, and lead to where it can be removed.
  const phones = s.remote?.devices.filter((d) => d.connected) ?? []

  return (
    <footer className="statusbar">
      {project ? (
        <span className="sb-item thread" data-color={project.color} title={project.path}>
          <ProjectMark project={project} size={14} />
          {project.name}
        </span>
      ) : null}
      {git ? (
        <button
          className="sb-item sb-git"
          title="Branch and uncommitted changes. Click to review, commit, push or switch branch"
          onClick={() => s.set({ rightPanelOpen: true, rightPanelView: 'changes' })}
        >
          <GitBranch />
          {git.branch ?? 'no branch'}
          {git.changes ? <span className="sb-muted">{git.changes === 1 ? '1 change' : `${git.changes} changes`}</span> : <span className="sb-muted">clean</span>}
          {git.ahead ? <span className="sb-muted">{git.ahead} to push</span> : null}
          {git.behind ? <span className="sb-muted">{git.behind} to pull</span> : null}
        </button>
      ) : null}
      <span className="sb-spacer" />
      <UpdateButton />
      {waiting ? (
        <span className="sb-item sb-warn">{waiting === 1 ? '1 chat needs you' : `${waiting} chats need you`}</span>
      ) : null}
      {running ? (
        <span className="sb-item">
          <span className="live-dot" aria-hidden="true" />
          {running === 1 ? '1 chat working' : `${running} chats working`}
          {agents ? <span className="sb-muted">{agents === 1 ? '1 agent' : `${agents} agents`}</span> : null}
        </span>
      ) : null}
      {phones.length ? (
        <button
          className="sb-item sb-phone"
          title={`${phones.map((d) => d.name).join(', ')} ${phones.length === 1 ? 'is' : 'are'} connected to Loom. Click for Phone access in Settings`}
          onClick={() => s.openSettings()}
        >
          <Smartphone />
          {phones.length === 1 ? 'Phone connected' : `${phones.length} phones connected`}
        </button>
      ) : null}
      {mode ? <span className="sb-item sb-muted">{MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode}</span> : null}
      {chat?.activeModel ? <span className="sb-item sb-muted">{modelName(chat.activeModel, s.knownModels)}</span> : null}
      <ServersStatus />
      <UsageMeters />
    </footer>
  )
}
