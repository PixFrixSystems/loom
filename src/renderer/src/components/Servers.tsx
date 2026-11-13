import { Check, ChevronDown, Copy, Download, ExternalLink, Globe, LoaderCircle, Play, RotateCw, ScrollText, Server, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Project, RunTarget, ServerInfo, TunnelInfo } from '@shared/types'
import { useStore, type MenuItem } from '../store'
import { ProjectMark } from './ProjectMark'

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function isLive(x: ServerInfo): boolean {
  return x.status === 'starting' || x.status === 'running' || x.status === 'stopping'
}

function failed(x: ServerInfo): boolean {
  return x.status === 'exited' && x.exitCode !== 0
}

/** "dev", or "start in newsroom" when it runs in a sub folder. */
export function targetName(t: RunTarget): string {
  return t.where ? `${t.script} in ${t.where}` : t.script
}

function runTitle(t: RunTarget): string {
  return `Run ${t.command}${t.where ? ` in ${t.where}` : ''}${t.detail ? `\n${t.detail}` : ''}`
}

function stateText(x: ServerInfo): string {
  if (x.status === 'starting') return x.installing ? 'Installing dependencies' : 'Starting'
  if (x.status === 'stopping') return 'Stopping'
  if (x.status === 'running') return x.url ? hostOf(x.url) : 'Running'
  if (x.status === 'exited') return x.exitCode === 0 ? 'Finished' : `Exited, code ${x.exitCode}`
  return 'Stopped'
}

function openUrl(url: string | null): void {
  if (url) void window.loom.openExternal(url)
}

/** The server a project's controls should talk about: a live one first, else one that ended on its own. */
export function primaryServer(servers: ServerInfo[], projectId: string): ServerInfo | undefined {
  const mine = servers.filter((x) => x.projectId === projectId)
  return mine.find(isLive) ?? mine.find((x) => x.status === 'exited')
}

export function defaultTarget(project: Project, targets: RunTarget[] | undefined): RunTarget | undefined {
  return targets?.find((t) => t.id === project.runTargetId) ?? targets?.[0]
}

/** A cloud, in Cloudflare's orange: the sign for a public link. Filled while one is open. */
export function CloudMark({ filled = false, className }: { filled?: boolean; className?: string }): ReactNode {
  return (
    <svg className={`cloud-mark${filled ? ' filled' : ''}${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 19H7a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 18.86 8.6 5.25 5.25 0 0 1 17.5 19Z" />
    </svg>
  )
}

/** The link as it reads: the address and, when the site lives below the root, its path. */
function publicLink(t: TunnelInfo): string {
  return `${t.url}${t.path}`
}

/** Share a running server with a public link, or stop sharing it. */
function ShareButton({ server }: { server: ServerInfo }): ReactNode {
  const canShare = useStore((s) => s.canShare)
  const tunnel = useStore((s) => s.tunnels.find((t) => t.serverId === server.id))
  const s = useStore.getState()
  if (!canShare) return null
  if (tunnel && tunnel.state !== 'error') {
    const busy = tunnel.state !== 'live'
    return (
      <button
        className={`icon-btn small srv-share is-on${busy ? ' is-busy' : ''}`}
        title={busy ? 'Getting a public link. Click to cancel' : `Stop sharing ${publicLink(tunnel)}`}
        aria-label={busy ? 'Cancel the public link' : 'Stop sharing'}
        onClick={() => s.stopSharing(server.id)}
      >
        {busy ? <LoaderCircle className="spin" /> : <CloudMark filled />}
      </button>
    )
  }
  return (
    <button
      className="icon-btn small srv-share"
      title={'Share with a public link (Cloudflare Tunnel), to show the site to a client.\nAnyone with the link can see it until you stop sharing.'}
      aria-label="Share with a public link"
      onClick={() => void s.shareServer(server.id)}
    >
      <CloudMark />
    </button>
  )
}

/** Under a server in the list: its public link, the link on its way, or why it failed. */
function TunnelLine({ tunnel }: { tunnel: TunnelInfo | undefined }): ReactNode {
  const [copied, setCopied] = useState(false)
  if (!tunnel) return null
  if (tunnel.state === 'error') {
    return (
      <span className="srv-row-why" title={tunnel.error}>
        Public link failed: {tunnel.error}
      </span>
    )
  }
  if (tunnel.state === 'starting') return <span className="tunnel-line is-waiting">Asking Cloudflare for a public link</span>
  const link = publicLink(tunnel)
  const host = hostOf(link)
  if (tunnel.state === 'checking') {
    return (
      <span className="tunnel-line is-waiting" title={link}>
        Opening {host}, usually within a minute
      </span>
    )
  }
  return (
    <span className="tunnel-line">
      <button
        className="tunnel-link"
        title={`Copy ${link}`}
        onClick={() => {
          void navigator.clipboard.writeText(link)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
      >
        {copied ? <Check /> : <Copy />}
        <span className="tunnel-host">{copied ? 'Link copied' : host}</span>
      </button>
      <button className="icon-btn small" title={`Open ${link} in the browser`} aria-label="Open the public link" onClick={() => openUrl(link)}>
        <ExternalLink />
      </button>
    </span>
  )
}

/** Status, then the actions that fit it. Used in chat headers, output tabs and the servers list. */
export function ServerControls({
  server,
  output = true,
  dismiss = false,
  reason = true,
  share = false
}: {
  server: ServerInfo
  output?: boolean
  dismiss?: boolean
  /** Say why it ended next to its state; off where the reason has a line of its own */
  reason?: boolean
  /** Offer a public link through Cloudflare (in the Dev servers list) */
  share?: boolean
}): ReactNode {
  const s = useStore.getState()
  const live = isLive(server)
  const why = failed(server) ? server.reason : null
  return (
    <span className="srv-controls">
      {server.status === 'running' && server.url ? (
        <button
          className="srv-link"
          title={`Open ${server.url} in the browser${server.adopted ? `\nThis server was already running; Loom didn't start it` : ''}`}
          aria-label={`Open ${server.url} in the browser`}
          onClick={() => openUrl(server.url)}
        >
          <span className="srv-dot" aria-hidden="true" />
          <span className="srv-host">{hostOf(server.url)}</span>
        </button>
      ) : (
        <span className={`srv-state${failed(server) ? ' is-failed' : ''}`} role="status" title={why ?? undefined}>
          {server.status === 'starting' || server.status === 'stopping' ? <LoaderCircle className="spin" /> : null}
          {why && reason ? `${stateText(server)}:` : stateText(server)}
          {why && reason ? <span className="srv-reason">{why}</span> : null}
        </span>
      )}
      {server.status === 'running' && server.url ? (
        <button className="icon-btn small srv-preview" title="Preview in Loom, beside this" onClick={() => s.openPreview(server.projectId, server.url!)}>
          <Globe />
        </button>
      ) : null}
      {share && server.status === 'running' && server.url ? <ShareButton server={server} /> : null}
      {output ? (
        <button className="icon-btn small srv-output" title="Show output" onClick={() => s.showServerOutput(server.id)}>
          <ScrollText />
        </button>
      ) : null}
      {live ? (
        <>
          <button className="icon-btn small srv-restart" title="Restart" disabled={server.status === 'stopping'} onClick={() => s.restartServer(server.id)}>
            <RotateCw />
          </button>
          <button className="icon-btn small" title="Stop" disabled={server.status === 'stopping'} onClick={() => s.stopServer(server.id)}>
            <Square />
          </button>
        </>
      ) : (
        <>
          {server.needsInstall ? (
            <button
              className="run-btn"
              title={`Install the dependencies, then run ${server.target.command}`}
              onClick={() => s.restartServer(server.id, true)}
            >
              <Download />
              Install and run
            </button>
          ) : null}
          <button className="icon-btn small" title={`Run ${server.target.command} again`} onClick={() => s.restartServer(server.id)}>
            <Play />
          </button>
          {dismiss ? (
            <button className="icon-btn small" title="Remove from the list" onClick={() => s.dismissServer(server.id)}>
              <X />
            </button>
          ) : null}
        </>
      )}
    </span>
  )
}

function chooseTarget(at: { clientX: number; clientY: number }, project: Project, targets: RunTarget[]): void {
  const s = useStore.getState()
  const current = defaultTarget(project, targets)
  s.showMenu(
    at,
    targets.map((t) => ({
      label: `${t.command}${t.where ? ` in ${t.where}` : ''}`,
      checked: t.id === current?.id,
      onSelect: () => void s.runProject(project.id, t.id)
    }))
  )
}

/** The one-click Run button in a chat header, or the running server's controls. */
export function RunControl({ projectId }: { projectId: string | null }): ReactNode {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const targets = useStore((s) => (projectId ? s.runTargets[projectId] : undefined))
  const servers = useStore((s) => s.servers)
  if (!project) return null
  const server = primaryServer(servers, project.id)
  if (server) return <ServerControls server={server} />
  const target = defaultTarget(project, targets)
  if (!target || !targets) return null
  return (
    <span className="run-split">
      <button
        className="run-btn"
        title={runTitle(target)}
        aria-label={`Run ${target.script}`}
        onClick={() => void useStore.getState().runProject(project.id)}
      >
        <Play />
        <span className="run-label">Run {target.script}</span>
      </button>
      {targets.length > 1 ? (
        <button
          className="run-more"
          title="Choose what to run"
          aria-label="Choose what to run"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            chooseTarget({ clientX: r.left, clientY: r.bottom + 4 }, project, targets)
          }}
        >
          <ChevronDown />
        </button>
      ) : null}
    </span>
  )
}

/** A project's server state in the sidebar: the port while it runs. */
export function ServerMark({ projectId }: { projectId: string }): ReactNode {
  const servers = useStore((s) => s.servers)
  const server = primaryServer(servers, projectId)
  if (!server) return null
  const port = server.url?.match(/:(\d+)/)?.[1]
  const open = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (server.status === 'running' && server.url) openUrl(server.url)
    else useStore.getState().showServerOutput(server.id)
  }
  if (server.status === 'running') {
    return (
      <button className="srv-port" title={server.url ? `Open ${server.url}` : 'Show server output'} onClick={open}>
        {port ? `:${port}` : 'live'}
      </button>
    )
  }
  if (failed(server)) {
    return (
      <button
        className="srv-port is-failed"
        title={`${server.target.command} exited with code ${server.exitCode}${server.reason ? `: ${server.reason}` : ''}. Show output`}
        onClick={open}
      >
        exited
      </button>
    )
  }
  if (server.status === 'starting') return <LoaderCircle className="spin srv-spin" aria-label="Server starting" />
  return null
}

/** Run and server items for a project's right-click menu. */
export function projectRunItems(project: Project): MenuItem[] {
  const s = useStore.getState()
  const targets = s.runTargets[project.id] ?? []
  const mine = s.servers.filter((x) => x.projectId === project.id)
  const items: MenuItem[] = []

  const actions = (x: ServerInfo, single: boolean): MenuItem[] =>
    isLive(x)
      ? [
          { label: x.url ? `Preview ${hostOf(x.url)} in Loom` : 'Preview in Loom', disabled: !x.url, onSelect: () => s.openPreview(x.projectId, x.url!) },
          { label: x.url ? `Open ${hostOf(x.url)} in your browser` : 'Open in your browser', disabled: !x.url, onSelect: () => openUrl(x.url) },
          { label: single ? 'Show server output' : 'Show output', onSelect: () => s.showServerOutput(x.id) },
          { label: single ? 'Restart the server' : 'Restart', onSelect: () => s.restartServer(x.id) },
          { label: single ? 'Stop the server' : 'Stop', onSelect: () => s.stopServer(x.id) }
        ]
      : [
          ...(x.needsInstall ? [{ label: 'Install dependencies and run', onSelect: () => s.restartServer(x.id, true) }] : []),
          { label: single ? 'Show server output' : 'Show output', onSelect: () => s.showServerOutput(x.id) },
          { label: `Run ${x.target.command} again`, onSelect: () => s.restartServer(x.id) }
        ]

  if (mine.length === 1) items.push(...actions(mine[0], true))
  else for (const x of mine) items.push({ label: `${targetName(x.target)}: ${stateText(x)}`, submenu: actions(x, false) })

  const idle = targets.filter((t) => !mine.some((x) => x.target.id === t.id))
  if (idle.length === 1 && targets.length === 1) {
    items.push({ label: `Run ${idle[0].command}`, onSelect: () => void s.runProject(project.id, idle[0].id) })
  } else if (idle.length) {
    const current = defaultTarget(project, targets)
    items.push({
      label: mine.length ? 'Run something else' : 'Run',
      submenu: idle.map((t) => ({
        label: `${t.command}${t.where ? ` in ${t.where}` : ''}`,
        checked: t.id === current?.id,
        onSelect: () => void s.runProject(project.id, t.id)
      }))
    })
  }
  return items
}

function ServersPopover({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const servers = useStore((s) => s.servers)
  const projects = useStore((s) => s.projects)
  const tunnels = useStore((s) => s.tunnels)
  // Signed in to Cloudflare or installed cloudflared since: the share buttons follow.
  useEffect(() => void useStore.getState().checkSharing(), [])
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.sb-servers')) onClose()
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
  useEffect(() => {
    if (!servers.length) onClose()
  }, [servers.length, onClose])
  const live = servers.filter(isLive)
  const right = Math.max(8, window.innerWidth - anchor.right)
  return createPortal(
    <div ref={ref} className="menu usage-pop servers-pop" style={{ right, bottom: window.innerHeight - anchor.top + 6 }} role="dialog" aria-label="Dev servers">
      <div className="usage-head">
        <span className="usage-title">Dev servers</span>
      </div>
      {servers.map((x) => {
        const p = projects.find((pp) => pp.id === x.projectId)
        return (
          <div key={x.id} className="srv-row thread" data-color={p?.color}>
            <ProjectMark project={p} size={14} />
            <div className="srv-row-text">
              <span className="srv-row-name">{p?.name ?? 'Removed project'}</span>
              <span className="srv-row-cmd" title={x.target.detail}>
                {x.target.command}
                {x.target.where ? ` in ${x.target.where}` : ''}
              </span>
              {failed(x) && x.reason ? (
                <span className="srv-row-why" title={x.reason}>
                  {x.reason}
                </span>
              ) : null}
            </div>
            <ServerControls server={x} dismiss reason={false} share />
            {/* The public link gets a line of its own, wide enough to read it whole. */}
            <TunnelLine tunnel={tunnels.find((t) => t.serverId === x.id)} />
          </div>
        )
      })}
      {live.length > 1 ? (
        <div className="usage-foot">
          <span>{live.length} running</span>
          <button className="btn ghost" onClick={() => live.forEach((x) => useStore.getState().stopServer(x.id))}>
            <Square /> Stop all
          </button>
        </div>
      ) : null}
    </div>,
    document.body
  )
}

/** Status bar entry for every server Loom started, with the full list a click away. */
export function ServersStatus(): ReactNode {
  const servers = useStore((s) => s.servers)
  const projects = useStore((s) => s.projects)
  const shared = useStore((s) => s.tunnels.filter((t) => t.state === 'live' || t.state === 'checking').length)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  if (!servers.length) return null
  const bad = servers.filter(failed).length
  const one = servers.length === 1 ? servers[0] : null
  const label = one
    ? `${projects.find((p) => p.id === one.projectId)?.name ?? 'Server'} ${stateText(one)}`
    : `${servers.length} servers${bad ? `, ${bad} exited` : ''}`
  return (
    <>
      <button
        className={`sb-usage sb-servers${bad ? ' is-failed' : ''}`}
        title={`${one && failed(one) && one.reason ? `Dev servers. ${one.reason}` : 'Dev servers'}${shared ? `\n${shared === 1 ? 'One site is' : `${shared} sites are`} shared through a public Cloudflare link` : ''}`}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        <Server />
        {label}
        {/* Something here is public: never out of sight while it is. */}
        {shared ? <CloudMark className="sb-shared" filled /> : null}
      </button>
      {anchor ? <ServersPopover anchor={anchor} onClose={() => setAnchor(null)} /> : null}
    </>
  )
}
