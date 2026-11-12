import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Play } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { ServerTab } from '@shared/types'
import { useStore } from '../store'
import { ProjectMark } from './ProjectMark'
import { ServerControls } from './Servers'
import { THEME } from './TerminalView'

/** The live output of a dev server Loom started. Closing the tab leaves the server running. */
export function ServerView({ tab, active, visible = active }: { tab: ServerTab; active: boolean; visible?: boolean }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const server = useStore((s) => s.servers.find((x) => x.id === tab.serverId))

  useEffect(() => {
    if (!host.current) return
    const t = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: false,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: THEME
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => void window.loom.openExternal(uri)))
    t.open(host.current)
    term.current = t
    fit.current = f

    t.attachCustomKeyEventHandler((e) => {
      if (e.defaultPrevented) return false
      if (e.type === 'keydown' && e.ctrlKey && e.code === 'KeyC') {
        // Copies a selection; with none, stops the server, as Ctrl+C does in a terminal.
        if (t.hasSelection()) {
          void navigator.clipboard.writeText(t.getSelection())
          t.clearSelection()
        } else useStore.getState().stopServer(tab.serverId)
        return false
      }
      if (e.ctrlKey && (e.key === 'Tab' || ['KeyW', 'KeyT', 'KeyP', 'KeyB'].includes(e.code))) return false
      return true
    })

    // Join the stream without gaps or repeats: the saved output first, then only what came after it.
    let shown = -1
    const queued: [string, number][] = []
    const write = (data: string, end: number): void => {
      if (end <= shown) return
      const fresh = end - shown
      t.write(fresh < data.length ? data.slice(data.length - fresh) : data)
      shown = end
    }
    const offData = window.loom.onServerData((id, data, end) => {
      if (id !== tab.serverId) return
      if (shown < 0) queued.push([data, end])
      else write(data, end)
    })
    void window.loom.serverLog(tab.serverId).then((log) => {
      if (log) t.write(log.text)
      shown = log?.end ?? 0
      for (const [d, e] of queued) write(d, e)
      queued.length = 0
    })

    const sub = t.onData((d) => window.loom.serverWrite(tab.serverId, d))
    const refit = (): void => {
      if (!host.current || host.current.offsetWidth === 0) return
      try {
        f.fit()
      } catch {
        // not laid out yet
      }
    }
    refit()
    const ro = new ResizeObserver(refit)
    ro.observe(host.current)

    return () => {
      ro.disconnect()
      offData()
      sub.dispose()
      t.dispose()
      term.current = null
    }
  }, [tab.serverId])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        // ignore
      }
      if (active && !useStore.getState().pointerFocus) term.current?.focus()
    })
  }, [active, visible])

  const targetId = tab.serverId.slice(tab.serverId.indexOf('|') + 1)

  return (
    <div className="termview">
      <div className="file-head">
        <ProjectMark project={project} />
        {project ? <span className="chat-head-project">{project.name}</span> : null}
        <span className="chat-head-path">{server?.target.command ?? tab.title}</span>
        <span className="chat-head-spacer" />
        {server ? (
          <ServerControls server={server} output={false} />
        ) : project ? (
          <span className="srv-controls">
            <span className="srv-state">Not running</span>
            <button className="run-btn" onClick={() => void useStore.getState().runProject(project.id, targetId)}>
              <Play /> Run
            </button>
          </span>
        ) : null}
      </div>
      <div className="term-host" ref={host} />
    </div>
  )
}
