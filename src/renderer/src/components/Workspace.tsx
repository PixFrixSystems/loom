import { FolderPlus, MessageSquarePlus, X } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LayoutNode, Tab } from '@shared/types'
import { paneOfTab, panesOf, type Edge, type Pane, type Split } from '../lib/layout'
import { projectForPath } from '../lib/paths'
import { useResizing } from '../lib/resizing'
import { isOverlayTab, useStore } from '../store'
import { ChatView } from './ChatView'
import { FileView } from './FileView'
import { Onboarding } from './Onboarding'
import { DiffView } from './DiffView'
import { PreviewView } from './PreviewView'
import { ProjectMark } from './ProjectMark'
import { ServerView } from './ServerView'
import { SettingsView } from './SettingsView'
import { TerminalView } from './TerminalView'
import wordmark from '../assets/brand/loom-wordmark.webp'
import wordmark2x from '../assets/brand/loom-wordmark@2x.webp'

type Rect = { left: number; top: number; width: number; height: number }

export function TabContent({ tab, active, visible }: { tab: Tab; active: boolean; visible: boolean }): ReactNode {
  switch (tab.kind) {
    case 'chat':
      return <ChatView tab={tab} active={active} visible={visible} />
    case 'file':
      return <FileView tab={tab} active={active} visible={visible} />
    case 'terminal':
      return <TerminalView tab={tab} active={active} visible={visible} />
    case 'settings':
      return <SettingsView />
    case 'server':
      return <ServerView tab={tab} active={active} visible={visible} />
    case 'browser':
      return <PreviewView tab={tab} active={active} visible={visible} />
    case 'diff':
      return <DiffView tab={tab} active={active} visible={visible} />
    case 'start':
      return <Onboarding visible={visible} />
  }
}

function Welcome(): ReactNode {
  const s = useStore()
  const recent = s.sessions.slice(0, 6)
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="welcome-title">
          <img className="welcome-wordmark" src={wordmark} srcSet={`${wordmark} 1x, ${wordmark2x} 2x`} alt="Loom" draggable={false} />
        </h1>
        <p>All your projects in one window. Chats, files and terminals from any project share the tab bar above.</p>
        <div className="welcome-actions">
          {s.projects.length ? (
            <button className="btn primary" onClick={() => s.newChat(s.projects[0].id)}>
              <MessageSquarePlus /> New chat in {s.projects[0].name}
            </button>
          ) : null}
          <button className={`btn${s.projects.length ? '' : ' primary'}`} onClick={() => void s.pickAndAddProject(null)}>
            <FolderPlus /> Add a project folder
          </button>
        </div>
        {recent.length ? (
          <section className="welcome-recent">
            <h2>Recent chats</h2>
            {recent.map((x) => {
              const p = projectForPath(s.projects, x.cwd)
              return (
                <button key={x.sessionId} className="recent-row thread" data-color={p?.color} onClick={() => s.openSession(x)}>
                  <ProjectMark project={p} />
                  <span className="recent-title">{x.title}</span>
                  <span className="recent-where">{p?.name ?? x.cwd}</span>
                </button>
              )
            })}
          </section>
        ) : null}
      </div>
    </div>
  )
}

/** Where a pane's tab is drawn. The tab itself is drawn on top, so it never remounts when panes change. */
function PaneSlot({ pane, multi, focused }: { pane: Pane; multi: boolean; focused: boolean }): ReactNode {
  const hasTabs = useStore((s) => s.tabs.length > 0)
  return (
    <div
      className={`pane-slot${multi && focused ? ' focused' : ''}`}
      data-pane={pane.id}
      onPointerDown={() => useStore.getState().focusPane(pane.id, true)}
    >
      {pane.tabId ? null : !hasTabs && !multi ? (
        <Welcome />
      ) : (
        <div className="pane-empty">
          <p>Nothing showing here.</p>
          <p className="pane-empty-hint">Pick a tab above while this pane is selected, or drag a tab onto it.</p>
          {multi ? (
            <button className="btn ghost" onClick={() => useStore.getState().closePane(pane.id)}>
              Close this pane
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SplitHandle({ split, index }: { split: Split; index: number }): ReactNode {
  const start = useRef<{ pos: number; size: number; sizes: number[] } | null>(null)
  const [dragging, setDragging] = useState(false)
  useResizing(dragging)
  const row = split.dir === 'row'
  return (
    <div
      className={`split-handle ${row ? 'is-row' : 'is-column'}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
        start.current = { pos: row ? e.clientX : e.clientY, size: row ? box.width : box.height, sizes: [...split.sizes] }
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const st = start.current
        if (!st || st.size <= 0) return
        const delta = ((row ? e.clientX : e.clientY) - st.pos) / st.size
        const a = st.sizes[index - 1]
        const b = st.sizes[index]
        // Each pane keeps about 160px, unless the two together are too small for that.
        const min = Math.min(0.45, 160 / st.size, (a + b) / 2)
        const d = Math.max(min - a, Math.min(b - min, delta))
        const sizes = [...st.sizes]
        sizes[index - 1] = a + d
        sizes[index] = b - d
        useStore.getState().resizeSplit(split.id, sizes)
      }}
      onPointerUp={() => {
        start.current = null
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        start.current = null
        setDragging(false)
      }}
      onDoubleClick={() => useStore.getState().resizeSplit(split.id, split.sizes.map(() => 1 / split.sizes.length))}
      title="Drag to resize. Double-click to even out"
    />
  )
}

function LayoutView({ node, multi, focusedPane }: { node: LayoutNode; multi: boolean; focusedPane: string }): ReactNode {
  if (node.kind === 'pane') return <PaneSlot pane={node} multi={multi} focused={node.id === focusedPane} />
  return (
    <div className={`split split-${node.dir}`}>
      {node.children.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 ? <SplitHandle split={node} index={i} /> : null}
          <div className="split-cell" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <LayoutView node={c} multi={multi} focusedPane={focusedPane} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function zoneAt(e: React.DragEvent, el: HTMLElement): Edge | 'center' {
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  const edges: [Edge, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y]
  ]
  const [edge, dist] = edges.sort((a, b) => a[1] - b[1])[0]
  return dist < 0.25 ? edge : 'center'
}

/** While a tab is dragged: drop in the middle of a pane to show it there, near an edge to split. */
function DropTargets({ panes, rects }: { panes: Pane[]; rects: Record<string, Rect> }): ReactNode {
  const [hint, setHint] = useState<{ pane: string; zone: Edge | 'center' } | null>(null)
  return (
    <div className="drop-layer">
      {panes.map((p) => {
        const r = rects[p.id]
        if (!r) return null
        return (
          <div
            key={p.id}
            className="drop-pane"
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('loom/tab')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const zone = zoneAt(e, e.currentTarget)
              if (hint?.pane !== p.id || hint.zone !== zone) setHint({ pane: p.id, zone })
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('loom/tab')
              const zone = zoneAt(e, e.currentTarget)
              setHint(null)
              const s = useStore.getState()
              s.set({ draggingTab: null })
              if (!id) return
              if (zone === 'center') s.moveTabToPane(id, p.id)
              else s.splitPane(zone, id, p.id)
            }}
          >
            {hint?.pane === p.id ? <div className={`drop-hint zone-${hint.zone}`} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function sameRects(a: Record<string, Rect>, b: Record<string, Rect>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => {
    const x = a[k]
    const y = b[k]
    return !!y && x.left === y.left && x.top === y.top && x.width === y.width && x.height === y.height
  })
}

/** The work area: one or more panes, each showing a tab. */
export function Workspace(): ReactNode {
  const tabs = useStore((s) => s.tabs)
  const layout = useStore((s) => s.layout)
  const focusedPane = useStore((s) => s.focusedPane)
  const dragging = useStore((s) => s.draggingTab)
  const detached = useStore((s) => s.detached)
  const activeTabId = useStore((s) => s.activeTabId)
  const main = useRef<HTMLElement>(null)
  const [full, setFull] = useState<Rect | null>(null)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [mounted, setMounted] = useState<Set<string>>(new Set())
  const panes = panesOf(layout)
  const multi = panes.length > 1
  const overlayOpen = isOverlayTab(tabs.find((t) => t.id === activeTabId))

  // A tab is built the first time it shows, then kept (hidden) so it keeps its state.
  useEffect(() => {
    const shown = panes.map((p) => p.tabId).filter((id): id is string => !!id)
    if (shown.some((id) => !mounted.has(id))) {
      setMounted((m) => {
        const next = new Set(m)
        shown.forEach((id) => next.add(id))
        return next
      })
    }
  }, [layout])

  useLayoutEffect(() => {
    const root = main.current
    if (!root) return
    const measure = (): void => {
      const base = root.getBoundingClientRect()
      setFull((prev) => (prev && prev.width === Math.round(base.width) && prev.height === Math.round(base.height) ? prev : { left: 0, top: 0, width: Math.round(base.width), height: Math.round(base.height) }))
      const next: Record<string, Rect> = {}
      root.querySelectorAll<HTMLElement>('[data-pane]').forEach((el) => {
        const r = el.getBoundingClientRect()
        next[el.dataset.pane!] = {
          left: Math.round(r.left - base.left),
          top: Math.round(r.top - base.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      })
      setRects((prev) => (sameRects(prev, next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    root.querySelectorAll('[data-pane]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [layout])

  return (
    <main className={`content${multi ? ' is-split' : ''}`} ref={main}>
      <LayoutView node={layout} multi={multi} focusedPane={focusedPane} />
      {tabs
        .filter((t) => !detached[t.id] && (mounted.has(t.id) || paneOfTab(layout, t.id) || (isOverlayTab(t) && t.id === activeTabId)))
        .map((t) => {
          // Settings covers the whole work area while it is the open tab; the panes stay as they are below.
          if (isOverlayTab(t)) {
            const shown = t.id === activeTabId && !!full
            return (
              <div key={t.id} className="tab-panel overlay-panel" hidden={!shown} style={shown ? { left: 0, top: 0, width: full!.width, height: full!.height, right: 'auto', bottom: 'auto' } : undefined}>
                <TabContent tab={t} active={shown} visible={shown} />
              </div>
            )
          }
          const pane = paneOfTab(layout, t.id)
          const rect = pane ? rects[pane.id] : undefined
          const visible = !!rect && !overlayOpen
          const focused = visible && pane!.id === focusedPane
          return (
            <div
              key={t.id}
              className={`tab-panel${multi && focused ? ' focused' : ''}`}
              hidden={!visible}
              style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: 'auto', bottom: 'auto' } : undefined}
              onPointerDownCapture={() => pane && useStore.getState().focusPane(pane.id, true)}
            >
              <TabContent tab={t} active={focused} visible={visible} />
              {multi && visible ? (
                // With the screen split, each pane closes what it shows from its own corner.
                <button
                  className="icon-btn small pane-close"
                  title={`Close ${t.title}${focused ? ' (Ctrl+W)' : ''}`}
                  aria-label={`Close ${t.title}`}
                  onClick={() => void useStore.getState().requestClose([t.id])}
                >
                  <X />
                </button>
              ) : null}
            </div>
          )
        })}
      {dragging ? <DropTargets panes={panes} rects={rects} /> : null}
    </main>
  )
}
