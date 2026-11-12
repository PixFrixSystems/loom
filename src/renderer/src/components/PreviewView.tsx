import { ArrowLeft, ArrowRight, Bug, ExternalLink, LoaderCircle, Monitor, Play, RotateCw, Smartphone, Tablet } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserTab } from '@shared/types'
import { paneOfTab } from '../lib/layout'
import { useStore } from '../store'
import { ProjectMark } from './ProjectMark'
import { defaultTarget } from './Servers'

/** The parts of Electron's <webview> this view uses. */
interface Webview extends HTMLElement {
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  openDevTools(): void
}

const DEVICES = [
  { width: null, label: 'Full width', Icon: Monitor },
  { width: 768, label: 'Tablet, 768 px wide', Icon: Tablet },
  { width: 390, label: 'Phone, 390 px wide', Icon: Smartphone }
] as const

/** What was typed into the address bar, as an address: "localhost:3000" becomes http://localhost:3000/. */
function toUrl(typed: string): string {
  const t = typed.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(t) || /^[\w.-]+:\d+(\/|$)/.test(t)) return `http://${t}`
  return `https://${t}`
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/** A web page inside Loom, usually a project's dev server, next to the chat working on it. */
export function PreviewView({ tab, active }: { tab: BrowserTab; active: boolean; visible?: boolean }): ReactNode {
  const view = useRef<Webview | null>(null)
  const ready = useRef(false)
  const [first] = useState(tab.url)
  const [address, setAddress] = useState(tab.url)
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const targets = useStore((s) => (tab.projectId ? s.runTargets[tab.projectId] : undefined))
  const server = useStore((s) => s.servers.find((x) => x.projectId === tab.projectId && !!x.url && sameOrigin(x.url, tab.url)))
  const anyServer = useStore((s) => s.servers.some((x) => x.projectId === tab.projectId && (x.status === 'starting' || x.status === 'running')))

  useEffect(() => {
    const el = view.current
    if (!el) return
    const update = useStore.getState().updateTab
    const sync = (): void => {
      if (!ready.current) return
      const url = el.getURL()
      // Not while you're typing an address: a reload would replace what you typed.
      if (!editingRef.current) setAddress(url)
      setNav({ back: el.canGoBack(), forward: el.canGoForward() })
      if (url && url !== 'about:blank') update(tab.id, { url } as Partial<BrowserTab>)
    }
    const onReady = (): void => {
      ready.current = true
      sync()
    }
    const onNavigate = (): void => {
      setFailed(null)
      sync()
    }
    const onTitle = (e: Event): void => {
      const title = (e as Event & { title?: string }).title
      if (title) update(tab.id, { title: title.length > 60 ? `${title.slice(0, 60)}…` : title })
    }
    const onFail = (e: Event): void => {
      const f = e as Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
      // -3 is a navigation that was replaced by another one: not a failure.
      if (!f.isMainFrame || f.errorCode === -3) return
      setFailed(
        f.errorCode === -102 || f.errorCode === -105
          ? `Nothing is answering at ${f.validatedURL.replace(/^https?:\/\//, '').replace(/\/$/, '')}.`
          : `The page could not load (${f.errorDescription}).`
      )
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      sync()
    }
    // Clicking into the page makes its pane the one you're working in, like clicking anywhere else.
    const onFocus = (): void => {
      const s = useStore.getState()
      const pane = paneOfTab(s.layout, tab.id)
      if (pane) s.focusPane(pane.id, true)
    }
    const events: [string, (e: Event) => void][] = [
      ['dom-ready', onReady],
      ['did-navigate', onNavigate],
      ['did-navigate-in-page', onNavigate],
      ['page-title-updated', onTitle],
      ['did-fail-load', onFail],
      ['did-start-loading', onStart],
      ['did-stop-loading', onStop],
      ['focus', onFocus]
    ]
    for (const [name, fn] of events) el.addEventListener(name, fn)
    return () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn)
    }
  }, [tab.id])

  // The server came up after the page failed to load: try again by itself.
  useEffect(() => {
    if (failed && server?.status === 'running' && ready.current) view.current?.reload()
  }, [server?.status])

  useEffect(() => {
    if (active && !useStore.getState().pointerFocus) view.current?.focus()
  }, [active])

  const go = (url: string): void => {
    setFailed(null)
    setEditing(false)
    setAddress(url)
    // Before the page has ever loaded the view takes no commands; pointing it at the address works.
    if (ready.current) void view.current?.loadURL(url).catch(() => undefined)
    else view.current?.setAttribute('src', url)
  }
  const target = project ? defaultTarget(project, targets) : undefined
  const device = tab.device ?? null

  return (
    <div className="preview">
      <div className="file-head preview-bar thread" data-color={project?.color}>
        <ProjectMark project={project} />
        <span className="preview-nav">
          <button className="icon-btn small" title="Back" disabled={!nav.back} onClick={() => view.current?.goBack()}>
            <ArrowLeft />
          </button>
          <button className="icon-btn small" title="Forward" disabled={!nav.forward} onClick={() => view.current?.goForward()}>
            <ArrowRight />
          </button>
          <button className="icon-btn small" title="Reload (F5)" onClick={() => (ready.current ? view.current?.reload() : go(address))}>
            {loading ? <LoaderCircle className="spin" /> : <RotateCw />}
          </button>
        </span>
        <input
          className="preview-url selectable"
          value={editing ? address : address.replace(/^http:\/\//, '')}
          spellCheck={false}
          aria-label="Address"
          onFocus={(e) => {
            setEditing(true)
            editingRef.current = true
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => {
            setEditing(false)
            editingRef.current = false
          }}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(toUrl(address))
            if (e.key === 'Escape') {
              setAddress(view.current && ready.current ? view.current.getURL() : tab.url)
              e.currentTarget.blur()
            }
          }}
        />
        <span className="device-switch" role="group" aria-label="Page width">
          {DEVICES.map(({ width, label, Icon }) => (
            <button
              key={label}
              className={device === width ? 'on' : undefined}
              title={label}
              aria-label={label}
              aria-pressed={device === width}
              onClick={() => useStore.getState().updateTab(tab.id, { device: width } as Partial<BrowserTab>)}
            >
              <Icon />
            </button>
          ))}
        </span>
        <button className="icon-btn small preview-devtools" title="Developer tools (F12)" onClick={() => view.current?.openDevTools()}>
          <Bug />
        </button>
        <button className="icon-btn small" title="Open in your browser" onClick={() => void window.loom.openExternal(address)}>
          <ExternalLink />
        </button>
      </div>
      <div className={`preview-stage${device ? ' is-device' : ''}`}>
        <webview
          ref={(el) => {
            view.current = el as unknown as Webview | null
          }}
          className="preview-page"
          src={first}
          partition="persist:loom-preview"
          style={device ? { width: device } : undefined}
        />
        {failed ? (
          <div className="preview-failed">
            <p>{failed}</p>
            <p className="preview-failed-hint">
              {anyServer ? 'The dev server is still starting, or runs on another address.' : target ? 'Its dev server is not running.' : 'Check the address, or start the site.'}
            </p>
            <span className="preview-failed-actions">
              {target && !anyServer && project ? (
                <button className="run-btn" onClick={() => void useStore.getState().runProject(project.id)}>
                  <Play /> Run {target.script}
                </button>
              ) : null}
              <button className="btn ghost" onClick={() => go(toUrl(address))}>
                <RotateCw /> Try again
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
