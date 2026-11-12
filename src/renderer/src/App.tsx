import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ConfirmHost, ToastHost } from './components/Confirm'
import { ImageViewer } from './components/ImageViewer'
import { ContextMenuHost } from './components/Menu'
import { QuickOpen } from './components/QuickOpen'
import { RightPanel } from './components/RightPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { FileBar, TabBar } from './components/TabBar'
import { Workspace } from './components/Workspace'
import { inFileRow, panesOf } from './lib/layout'
import { useResizing } from './lib/resizing'
import { tabsInOrder, useStore } from './store'

/**
 * The key a shortcut means, by its place on the keyboard: with a Greek layout active, Ctrl+W
 * reports the letter "ς", but it is still the W key.
 */
export function shortcutKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (e.code === 'Backquote') return '`'
  if (e.code === 'Comma') return ','
  return e.key.toLowerCase()
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (s.confirm) return
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const key = shortcutKey(e)
      if (e.code === 'Backslash') {
        // Ctrl+\ splits to the right, Ctrl+Shift+\ splits down.
        e.preventDefault()
        s.splitPane(e.shiftKey ? 'bottom' : 'right')
      } else if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const list = panesOf(s.layout)
        if (list.length < 2) return
        e.preventDefault()
        const i = list.findIndex((p) => p.id === s.focusedPane)
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : list.length - 1
        s.focusPane(list[(i + step) % list.length].id)
      } else if (key === 'tab') {
        e.preventDefault()
        // In the order the tabs are shown, past the ones living in a window of their own.
        const list = tabsInOrder(s.tabs).filter((t) => !s.detached[t.id] || t.id === s.activeTabId)
        if (!list.length) return
        const i = list.findIndex((t) => t.id === s.activeTabId)
        const next = list[(i + (e.shiftKey ? list.length - 1 : 1) + list.length) % list.length]
        s.activate(next.id)
      } else if (key === 'w' && !e.shiftKey) {
        e.preventDefault()
        if (tab) void s.requestClose([tab.id])
        else if (panesOf(s.layout).length > 1) s.closePane()
      } else if (key === 't' && !e.shiftKey) {
        e.preventDefault()
        s.newChat(tab?.projectId ?? s.projects[0]?.id ?? null)
      } else if (key === 'p' && !e.shiftKey) {
        e.preventDefault()
        s.set({ quickOpen: !s.quickOpen })
      } else if (key === '`') {
        e.preventDefault()
        s.newTerminal(tab?.projectId ?? null)
      } else if (key === 'b' && e.altKey) {
        e.preventDefault()
        s.set({ rightPanelOpen: !s.rightPanelOpen })
      } else if (key === 'b') {
        e.preventDefault()
        s.set({ sidebarOpen: !s.sidebarOpen })
      } else if (key === ',') {
        e.preventDefault()
        s.openSettings()
      } else if (/^[1-9]$/.test(key) && !e.altKey && !e.shiftKey) {
        const list = tabsInOrder(s.tabs)
        const t = list[key === '9' ? list.length - 1 : Number(key) - 1]
        if (t) {
          e.preventDefault()
          s.activate(t.id)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

function Resizer({ side }: { side: 'left' | 'right' }): ReactNode {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  useResizing(dragging)
  return (
    <div
      className={`resizer resizer-${side}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        const s = useStore.getState()
        start.current = { x: e.clientX, w: side === 'left' ? s.sidebarWidth : s.rightPanelWidth }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const dx = e.clientX - start.current.x
        const w = Math.round(Math.max(200, Math.min(520, start.current.w + (side === 'left' ? dx : -dx))))
        useStore.getState().set(side === 'left' ? { sidebarWidth: w } : { rightPanelWidth: w })
      }}
      onPointerUp={() => {
        start.current = null
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        start.current = null
        setDragging(false)
      }}
    />
  )
}

export function App(): ReactNode {
  const s = useStore()
  useShortcuts()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  useEffect(() => {
    const onFocus = (): void => {
      void useStore.getState().refreshSessions()
      void useStore.getState().checkWatched()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  if (!s.ready) return <div className="boot" />

  const style = {
    '--sbw': s.sidebarOpen ? `${s.sidebarWidth}px` : '0px',
    '--rpw': s.rightPanelOpen ? `${s.rightPanelWidth}px` : '0px',
    '--filebar': s.tabs.some(inFileRow) ? '32px' : '0px'
  } as CSSProperties

  return (
    <div className="app" style={style}>
      {s.sidebarOpen ? (
        <>
          <div className="brand">
            <span className="brand-name">Loom</span>
          </div>
          <Sidebar />
          <Resizer side="left" />
        </>
      ) : null}
      <TabBar />
      <FileBar />
      <Workspace />
      {s.rightPanelOpen ? (
        <>
          <Resizer side="right" />
          <RightPanel />
        </>
      ) : null}
      <StatusBar />
      <ContextMenuHost />
      <ImageViewer />
      {s.quickOpen ? <QuickOpen /> : null}
      <ConfirmHost />
      <ToastHost />
    </div>
  )
}
