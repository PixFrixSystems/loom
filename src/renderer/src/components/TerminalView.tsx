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

/**
 * The brand's terminal: an inset well darker than the pane, ANSI colours from the same family as
 * the code colours. Bright black is the comment grey rather than near black, so dimmed output
 * (hints, timings) stays readable.
 */
export const THEME = {
  background: '#080a10',
  foreground: '#d9dce6',
  cursor: '#c8c6fa',
  cursorAccent: '#080a10',
  selectionBackground: '#4b47b8a0',
  black: '#0a0c12',
  red: '#ff8595',
  green: '#4fd18b',
  yellow: '#f0c38a',
  blue: '#9fb0ff',
  magenta: '#c8c6fa',
  cyan: '#8fd3c4',
  white: '#d9dce6',
  brightBlack: '#5f667a',
  brightRed: '#ffa3af',
  brightGreen: '#72dca3',
  brightYellow: '#f4d2a8',
  brightBlue: '#b6c3ff',
  brightMagenta: '#dcdafc',
  brightCyan: '#a9ddd1',
  brightWhite: '#f2f3f7'
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
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 8000,
      theme: THEME,
      // Programs print links as terminal hyperlinks too (Claude Code's sign-in address, for one):
      // those open in the browser like plain ones, instead of xterm's own prompt and window.
      linkHandler: { activate: (_e, uri) => void window.loom.openExternal(uri) }
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
      // A key Loom already used as a shortcut (Ctrl+\ to split, Ctrl+3 for a tab...) isn't also
      // typed into the shell, where it would mean something else.
      if (e.defaultPrevented) return false
      // Ctrl+C copies when there is a selection.
      if (e.type === 'keydown' && e.ctrlKey && e.code === 'KeyC' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection())
        t.clearSelection()
        return false
      }
      // Ctrl+V: the browser's own paste event reaches the terminal; doing it here too pasted twice.
      if (e.ctrlKey && e.code === 'KeyV') return false
      // Leave app shortcuts to the app, by key position so a Greek layout works too.
      if (e.ctrlKey && (e.key === 'Tab' || ['KeyW', 'KeyT', 'KeyP', 'KeyB'].includes(e.code))) return false
      return true
    })

    // Output that arrives before the shell is (re)attached waits, so a replayed screen comes first.
    let attached = false
    const early: string[] = []
    // A command to type in once the new shell is ready: on its first output, which is its prompt.
    let pending = tab.run ?? null
    const offData = window.loom.onPtyData((id, data) => {
      if (id !== tab.id) return
      if (attached) t.write(data)
      else early.push(data)
      if (pending) {
        const cmd = pending
        pending = null
        setTimeout(() => window.loom.ptyWrite(tab.id, `${cmd}\r`), 250)
        useStore.getState().updateTab(tab.id, { run: undefined } as Partial<TerminalTab>)
      }
    })
    const offExit = window.loom.onPtyExit((id, code) => {
      if (id === tab.id) setExited(code)
    })
    const sub = t.onData((d) => window.loom.ptyWrite(tab.id, d))
    const resize = t.onResize(({ cols, rows }) => window.loom.ptyResize(tab.id, cols, rows))

    void window.loom.ptyCreate(tab.id, tab.cwd, t.cols, t.rows).then((r) => {
      if (!r.ok) setError(r.error)
      else if (r.replay) {
        // An already running shell: whatever was to be typed was typed back then.
        pending = null
        t.write(r.replay)
      }
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
      <div className="file-head">
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
