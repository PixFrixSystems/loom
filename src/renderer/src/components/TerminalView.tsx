import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TerminalTab } from '@shared/types'
import { relPath, shortPath } from '../lib/paths'
import { useStore } from '../store'
import { ProjectMark } from './ProjectMark'

export const THEME = {
  background: '#17191c',
  foreground: '#e8e4dc',
  cursor: '#84c3b0',
  cursorAccent: '#17191c',
  selectionBackground: '#6fb5a150',
  black: '#2a2d33',
  red: '#e27d6b',
  green: '#a8c47f',
  yellow: '#dcb05a',
  blue: '#6f97c8',
  magenta: '#c59bd6',
  cyan: '#6fb5a1',
  white: '#d8d3ca',
  brightBlack: '#6d6963',
  brightRed: '#ee9787',
  brightGreen: '#bdd699',
  brightYellow: '#ebc679',
  brightBlue: '#8fb0d9',
  brightMagenta: '#d6b3e3',
  brightCyan: '#8fcab8',
  brightWhite: '#f3efe8'
}

export function TerminalView({ tab, active, visible = active }: { tab: TerminalTab; active: boolean; visible?: boolean }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [exited, setExited] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const home = useStore((s) => s.info?.homeDir)

  useEffect(() => {
    if (!host.current) return
    const t = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 8000,
      theme: THEME
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => void window.loom.openExternal(uri)))
    t.open(host.current)
    term.current = t
    fit.current = f
    try {
      f.fit()
    } catch {
      // hidden on first paint
    }
    setExited(null)
    setError(null)

    t.attachCustomKeyEventHandler((e) => {
      // Ctrl+C copies when there is a selection; Ctrl+V pastes.
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection())
        t.clearSelection()
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        void navigator.clipboard.readText().then((text) => window.loom.ptyWrite(tab.id, text))
        return false
      }
      // Leave app shortcuts to the app.
      if (e.ctrlKey && ['Tab', 'w', 't', 'p', 'b'].includes(e.key)) return false
      return true
    })

    // Output that arrives before the shell is (re)attached waits, so a replayed screen comes first.
    let attached = false
    const early: string[] = []
    const offData = window.loom.onPtyData((id, data) => {
      if (id !== tab.id) return
      if (attached) t.write(data)
      else early.push(data)
    })
    const offExit = window.loom.onPtyExit((id, code) => {
      if (id === tab.id) setExited(code)
    })
    const sub = t.onData((d) => window.loom.ptyWrite(tab.id, d))
    const resize = t.onResize(({ cols, rows }) => window.loom.ptyResize(tab.id, cols, rows))

    void window.loom.ptyCreate(tab.id, tab.cwd, t.cols, t.rows).then((r) => {
      if (!r.ok) setError(r.error)
      else if (r.replay) t.write(r.replay)
      attached = true
      for (const d of early) t.write(d)
      early.length = 0
    })

    const ro = new ResizeObserver(() => {
      if (host.current && host.current.offsetWidth > 0) {
        try {
          f.fit()
        } catch {
          // not laid out yet
        }
      }
    })
    ro.observe(host.current)

    return () => {
      ro.disconnect()
      offData()
      offExit()
      sub.dispose()
      resize.dispose()
      t.dispose()
      term.current = null
    }
  }, [tab.id, generation])

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

  const where = project ? relPath(tab.cwd, project.path) : shortPath(tab.cwd, home)

  return (
    <div className="termview">
      <div className="file-head thread" data-color={project?.color}>
        <ProjectMark project={project} />
        {project ? <span className="chat-head-project">{project.name}</span> : null}
        <span className="chat-head-path">{where === tab.cwd || !project ? shortPath(tab.cwd, home) : where}</span>
        <span className="chat-head-spacer" />
        {exited !== null || error ? (
          <span className="term-state">
            {error ? `The shell could not start: ${error}` : `The shell exited (code ${exited}).`}
            <button className="btn" onClick={() => setGeneration((g) => g + 1)}>
              <RotateCcw /> Restart
            </button>
          </span>
        ) : null}
      </div>
      <div className="term-host" ref={host} />
    </div>
  )
}
