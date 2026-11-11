import { GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { UsageLimit, UsageSnapshot } from '@shared/types'
import { timeAgo } from '../lib/paths'
import { modelName, useStore } from '../store'
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
      {!usage.available ? (
        <p className="usage-note">Plan limits are not available for this sign-in.</p>
      ) : usage.limits.length ? (
        usage.limits.map((l) => (
          <div key={l.key} className={`usage-row${l.active ? '' : ' inactive'}`}>
            <div className="usage-line">
              <span className="usage-label">{l.label === '5h' ? '5-hour session' : l.label === 'Week' ? 'This week' : l.label}</span>
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
  const shown = usage.limits.filter((l) => l.active && (l.label === '5h' || l.label === 'Week'))
  const list = shown.length ? shown : usage.limits.filter((l) => l.active).slice(0, 2)
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
            <span key={l.key} className="meter">
              <span className="meter-label">{l.label}</span>
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

export function StatusBar(): ReactNode {
  const s = useStore()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const project = s.projects.find((p) => p.id === tab?.projectId)
  const git = project ? s.git[project.id] : undefined
  const chat = tab?.kind === 'chat' ? s.chats[tab.id] : undefined
  const running = Object.values(s.chats).filter((c) => c.status === 'running' || c.status === 'starting').length
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

  return (
    <footer className="statusbar">
      {project ? (
        <span className="sb-item thread" data-color={project.color} title={project.path}>
          <ProjectMark project={project} fallback="sb-thread" size={14} />
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
      {waiting ? (
        <span className="sb-item sb-warn">{waiting === 1 ? '1 chat needs you' : `${waiting} chats need you`}</span>
      ) : null}
      {running ? (
        <span className="sb-item">
          <LoaderCircle className="spin" />
          {running === 1 ? '1 chat working' : `${running} chats working`}
        </span>
      ) : null}
      {mode ? <span className="sb-item sb-muted">{MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode}</span> : null}
      {chat?.activeModel ? <span className="sb-item sb-muted">{modelName(chat.activeModel, s.knownModels)}</span> : null}
      <ServersStatus />
      <UsageMeters />
    </footer>
  )
}
