import { AppWindow, ChevronDown, ChevronLeft, ChevronRight, FileText, GitCompare, Globe, MessageSquare, PanelLeft, PanelRight, Plus, Server, Settings, SquareTerminal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Tab } from '@shared/types'
import { inFileRow, paneOfTab } from '../lib/layout'
import { chatWorking, useStore, type MenuItem } from '../store'
import { LayoutButton } from './LayoutMenu'
import { ProjectMark } from './ProjectMark'
import mark from '../assets/brand/loom-mark.webp'
import mark2x from '../assets/brand/loom-mark@2x.webp'

type StripState = { over: boolean; left: boolean; right: boolean }

/** Whether a tab strip holds more than it can show, and on which side tabs are out of view. */
function useStrip(ref: RefObject<HTMLElement | null>, count: number): StripState {
  const [state, setState] = useState<StripState>({ over: false, left: false, right: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = (): void => {
      const over = el.scrollWidth > el.clientWidth + 1
      const left = over && el.scrollLeft > 1
      const right = over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setState((p) => (p.over === over && p.left === left && p.right === right ? p : { over, left, right }))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    el.addEventListener('scroll', check, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', check)
    }
  }, [count])
  return state
}

/** Arrows at the ends of a strip with tabs out of view: the plainest way to get to them. */
function StripArrows({ strip, state }: { strip: RefObject<HTMLElement | null>; state: StripState }): ReactNode {
  const by = (dir: number): void => {
    const el = strip.current
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' })
  }
  return (
    <>
      {state.left ? (
        <button className="strip-arrow is-left" title="Scroll to earlier tabs" aria-label="Scroll to earlier tabs" onClick={() => by(-1)}>
          <ChevronLeft />
        </button>
      ) : null}
      {state.right ? (
        <button className="strip-arrow is-right" title="Scroll to later tabs" aria-label="Scroll to later tabs" onClick={() => by(1)}>
          <ChevronRight />
        </button>
      ) : null}
    </>
  )
}

/** Every tab of a row in a menu, for when they don't all fit. */
function showAllTabs(e: React.MouseEvent, list: Tab[]): void {
  const s = useStore.getState()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  s.showMenu(
    { clientX: r.right - 280, clientY: r.bottom + 4 },
    list.map((t) => {
      const project = s.projects.find((p) => p.id === t.projectId)
      return { label: project ? `${project.name}: ${t.title}` : t.title, checked: t.id === s.activeTabId, onSelect: () => s.activate(t.id) }
    })
  )
}

function TabIcon({ tab }: { tab: Tab }): ReactNode {
  if (tab.kind === 'chat') return <MessageSquare />
  if (tab.kind === 'file') return <FileText />
  if (tab.kind === 'diff') return <GitCompare />
  // Get started carries the loop from the logo, the one small place the mark appears in a tab.
  if (tab.kind === 'start') return <img className="tab-mark" src={mark} srcSet={`${mark} 1x, ${mark2x} 2x`} alt="" draggable={false} />
  if (tab.kind === 'terminal') return <SquareTerminal />
  if (tab.kind === 'server') return <Server />
  if (tab.kind === 'browser') return <Globe />
  return <Settings />
}

function TabItem({ tab, index, compact = false }: { tab: Tab; index: number; compact?: boolean }): ReactNode {
  const s = useStore()
  const project = s.projects.find((p) => p.id === tab.projectId)
  const chat = s.chats[tab.id]
  const dirty = s.dirtyFiles[tab.id]
  const active = s.activeTabId === tab.id
  const pane = paneOfTab(s.layout, tab.id)
  const shown = !!pane && pane.id !== s.focusedPane
  const detached = !!s.detached[tab.id]
  const [drop, setDrop] = useState<'before' | 'after' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const el = useRef<HTMLDivElement>(null)

  // The tab you're on is always in view, however many are open.
  useEffect(() => {
    if (active) el.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const running = chatWorking(chat)
  const sameRow = s.tabs.filter((t) => inFileRow(t) === inFileRow(tab))
  const rowIndex = sameRow.findIndex((t) => t.id === tab.id)
  const waiting = chat && chat.permissions.length > 0

  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const items: MenuItem[] = [
      { label: 'Close', onSelect: () => void s.requestClose([tab.id]) },
      {
        label: inFileRow(tab) ? 'Close other files' : 'Close other tabs',
        disabled: sameRow.length < 2,
        onSelect: () => void s.requestClose(sameRow.filter((t) => t.id !== tab.id).map((t) => t.id))
      },
      {
        label: 'Close tabs to the right',
        disabled: rowIndex === sameRow.length - 1,
        onSelect: () => void s.requestClose(sameRow.slice(rowIndex + 1).map((t) => t.id))
      },
      { label: 'Reopen closed tab (Ctrl+Shift+T)', disabled: !s.closedTabs.length, onSelect: () => s.reopenClosed() },
      { separator: true, label: '' },
      ...(detached
        ? [{ label: 'Move back to this window', onSelect: () => void window.loom.popoutClose(tab.id) }]
        : [
            { label: 'Open to the right', onSelect: () => s.splitPane('right', tab.id) },
            { label: 'Open below', onSelect: () => s.splitPane('bottom', tab.id) },
            { label: 'Move to a new window', onSelect: () => s.popOut(tab.id) }
          ])
    ]
    if (tab.kind === 'chat') {
      items.push({ separator: true, label: '' }, { label: 'Rename', onSelect: () => setRenaming(true) })
      if (!detached && !(tab.provider === 'external' && tab.sessionId)) {
        items.push({
          label: 'Move to project',
          submenu: s.projects
            .filter((p) => p.id !== tab.projectId)
            .map((p) => ({ label: p.name, onSelect: () => void s.moveChat({ tabId: tab.id }, p.id) }))
        })
      }
    }
    if (tab.kind === 'file') {
      items.push(
        { separator: true, label: '' },
        { label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(tab.path) },
        { label: 'Show in File Explorer', onSelect: () => void window.loom.reveal(tab.path) }
      )
    }
    if (project) {
      items.push(
        { separator: true, label: '' },
        { label: `New chat in ${project.name}`, onSelect: () => s.newChat(project.id) },
        { label: `New terminal in ${project.name}`, onSelect: () => s.newTerminal(project.id) }
      )
    }
    s.showMenu(e, items)
  }

  return (
    <div
      ref={el}
      className={`tab thread${compact ? ' compact' : ''}${active ? ' active' : ''}${shown ? ' shown' : ''}${detached ? ' detached' : ''}${drop ? ` drop-${drop}` : ''}${project ? '' : ' no-project'}`}
      data-color={project?.color}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={`${project ? `${project.name}: ` : ''}${tab.title}${shown ? '\nShowing in another pane' : ''}${detached ? '\nIn its own window. Click to bring it forward' : ''}`}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData('loom/tab', tab.id)
        e.dataTransfer.effectAllowed = 'move'
        // After the drag has begun: changing the page during dragstart can cancel it.
        setTimeout(() => useStore.getState().set({ draggingTab: tab.id }), 0)
      }}
      onDragEnd={(e) => {
        useStore.getState().set({ draggingTab: null })
        // Let go outside Loom: the tab moves into a window of its own, right there.
        const { screenX: x, screenY: y } = e
        const outside =
          x < window.screenX || x > window.screenX + window.outerWidth || y < window.screenY || y > window.screenY + window.outerHeight
        if (e.dataTransfer.dropEffect === 'none' && outside && (x !== 0 || y !== 0)) s.popOut(tab.id, { x, y })
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('loom/tab')) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        setDrop(e.clientX < r.left + r.width / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('loom/tab')
        const side = drop
        setDrop(null)
        if (!id || id === tab.id) return
        const from = s.tabs.findIndex((t) => t.id === id)
        let to = side === 'after' ? index + 1 : index
        if (from < to) to -= 1
        s.moveTab(id, to)
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          void s.requestClose([tab.id])
        }
      }}
      onClick={() => s.activate(tab.id)}
      onDoubleClick={() => tab.kind === 'chat' && setRenaming(true)}
      onContextMenu={menu}
    >
      <span className="tab-icon">{running ? <span className="live-dot" role="img" aria-label="Agent is working" /> : detached ? <AppWindow /> : <TabIcon tab={tab} />}</span>
      <ProjectMark project={project} size={14} />
      {project && !compact ? <span className="tab-project">{project.name}</span> : null}
      {renaming ? (
        <input
          className="inline-edit"
          autoFocus
          defaultValue={tab.title}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim()
            if (v) {
              s.updateTab(tab.id, { title: v })
              if (tab.kind === 'chat' && tab.sessionId) {
                void window.loom.renameSession(tab.sessionId, v, tab.provider).catch((e: Error) => s.showToast(e.message))
              }
            }
            setRenaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className="tab-title">{tab.title}</span>
      )}
      <span className="tab-end">
        {waiting ? <span className="dot dot-warn" title="Waiting for your approval" /> : null}
        {!waiting && chat?.unread ? <span className="dot dot-accent" title="New reply" /> : null}
        {dirty ? <span className="dot dot-text" title="Unsaved changes" /> : null}
        <button
          className="tab-close"
          title="Close (Ctrl+W)"
          onClick={(e) => {
            e.stopPropagation()
            void s.requestClose([tab.id])
          }}
        >
          <X />
        </button>
      </span>
    </div>
  )
}

export function TabBar(): ReactNode {
  const s = useStore()
  const strip = useRef<HTMLDivElement>(null)
  const current = s.tabs.find((t) => t.id === s.activeTabId)
  const projectId = current?.projectId ?? null
  const rowTabs = s.tabs.filter((t) => !inFileRow(t))
  const strip2 = useStrip(strip, rowTabs.length)
  const over = strip2.over

  const addMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const project = s.projects.find((p) => p.id === projectId)
    const items: MenuItem[] = [
      { label: project ? `New chat in ${project.name}` : 'New chat', onSelect: () => s.newChat(projectId) },
      { label: project ? `New terminal in ${project.name}` : 'New terminal', onSelect: () => s.newTerminal(projectId) },
      { label: 'Open file…', onSelect: () => s.set({ quickOpen: true }) },
      { label: 'New browser tab', onSelect: () => s.openPreview(projectId, undefined, false) }
    ]
    if (s.projects.length > 1) {
      items.push(
        { separator: true, label: '' },
        {
          label: 'New chat in…',
          submenu: s.projects.map((p) => ({ label: p.name, onSelect: () => s.newChat(p.id) }))
        }
      )
    }
    s.showMenu({ clientX: r.left, clientY: r.bottom + 4 }, items)
  }

  return (
    <header className="topbar">
      {!s.sidebarOpen ? (
        <button className="icon-btn topbar-btn" title="Show sidebar (Ctrl+B)" onClick={() => s.set({ sidebarOpen: true })}>
          <PanelLeft />
        </button>
      ) : null}
      <div className="strip-wrap">
      <div
        ref={strip}
        className={`tabs${over ? ' is-over' : ''}`}
        role="tablist"
        onWheel={(e) => {
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY
        }}
        onDoubleClick={(e) => {
          if (e.target === strip.current) s.newChat(projectId)
        }}
      >
        {s.tabs.map((t, i) => (inFileRow(t) ? null : <TabItem key={t.id} tab={t} index={i} />))}
        <button className="icon-btn tab-add" title="New tab" onClick={addMenu}>
          <Plus />
        </button>
      </div>
      <StripArrows strip={strip} state={strip2} />
      </div>
      {over ? (
        <button className="icon-btn topbar-btn" title="All open tabs" aria-label="All open tabs" onClick={(e) => showAllTabs(e, rowTabs)}>
          <ChevronDown />
        </button>
      ) : null}
      <LayoutButton />
      <button
        className={`icon-btn topbar-btn${s.rightPanelOpen ? ' on' : ''}`}
        title="Files and Claude settings (Ctrl+Alt+B)"
        onClick={() => s.set({ rightPanelOpen: !s.rightPanelOpen })}
      >
        <PanelRight />
      </button>
      <div className="window-controls-space" />
    </header>
  )
}

/** Open files get their own row under the chats, so the two never mix. */
export function FileBar(): ReactNode {
  const tabs = useStore((s) => s.tabs)
  const strip = useRef<HTMLDivElement>(null)
  const files = tabs.filter(inFileRow)
  const state = useStrip(strip, files.length)
  const over = state.over
  if (!files.length) return null
  return (
    <div className="filebar">
      <div className="strip-wrap">
      <div
        ref={strip}
        className="filebar-tabs"
        role="tablist"
        aria-label="Open files"
        onWheel={(e) => {
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((t, i) => (inFileRow(t) ? <TabItem key={t.id} tab={t} index={i} compact /> : null))}
      </div>
      <StripArrows strip={strip} state={state} />
      </div>
      {over ? (
        <button className="icon-btn small filebar-all" title="All open files" aria-label="All open files" onClick={(e) => showAllTabs(e, files)}>
          <ChevronDown />
        </button>
      ) : null}
    </div>
  )
}
