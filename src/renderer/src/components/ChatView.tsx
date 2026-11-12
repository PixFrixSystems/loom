import { ArrowDown, FolderOpen, LoaderCircle, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatTab } from '@shared/types'
import { normPath, relPath, shortPath } from '../lib/paths'
import { EMPTY_CHAT, modelName, POPOUT_TAB, useLive, useStore } from '../store'
import { AgentTasks } from './AgentTasks'
import { ChatItemView, LiveThinking, rise, timelineClass, useArrivals } from './ChatItems'
import { Composer, composers } from './Composer'
import { Markdown } from './Markdown'
import { PermissionCard } from './PermissionCard'
import { ProjectMark } from './ProjectMark'
import { RunControl } from './Servers'

const PAGE = 200

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
/** A step's exact time: seconds matter when a minute holds a dozen steps. Other days add the date. */
const STEP_TODAY = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const STEP_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
const STEP_YEAR = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

/**
 * Text that changes many times a second, passed on at most every `ms`. A long reply being written
 * is drawn a few times a second instead of on every word.
 */
function useThrottled(value: string, ms: number): string {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = last.current + ms - Date.now()
    if (wait <= 0 || !value) {
      last.current = Date.now()
      setShown(value)
      return
    }
    const t = setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, wait)
    return () => clearTimeout(t)
  }, [value, ms])
  return value ? shown : ''
}

function clock(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : CLOCK.format(d)
}

function stepClock(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return STEP_TODAY.format(d)
  return (d.getFullYear() === now.getFullYear() ? STEP_DAY : STEP_YEAR).format(d)
}

/** When a step happened, shown after the pointer has rested on it for a moment. */
function HoverTime({ ts }: { ts?: string }): ReactNode {
  const label = stepClock(ts)
  return label ? (
    <time className="step-clock" dateTime={ts}>
      {label}
    </time>
  ) : null
}

/** Claude is working: the row's dot on the timeline pulses violet, as it does while Claude thinks. */
function Working({ since, what = 'Claude is working' }: { since?: number; what?: string }): ReactNode {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0
  const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
  return (
    <div className="working" role="status">
      <span>{what}</span>
      <span className="working-time">{label}</span>
    </div>
  )
}

export function ChatView({ tab, active, visible: shown = active }: { tab: ChatTab; active: boolean; visible?: boolean }): ReactNode {
  const s = useStore.getState()
  const chat = useStore((st) => st.chats[tab.id]) ?? EMPTY_CHAT
  const project = useStore((st) => st.projects.find((p) => p.id === tab.projectId))
  const knownModels = useStore((st) => st.knownModels)
  const homeDir = useStore((st) => st.info?.homeDir)
  const rawPartial = useLive((l) => l.partial[tab.id] ?? '')
  const thinking = useLive((l) => l.thinking[tab.id] ?? null)
  const partial = useThrottled(rawPartial, rawPartial.length < 3000 ? 50 : rawPartial.length < 15000 ? 150 : 300)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [focusKey, setFocusKey] = useState(0)
  /** The scroll height before "Show earlier messages", to keep your place after they're added above. */
  const grownFrom = useRef<number | null>(null)
  /** The content's height at the last change, and when it last got shorter while you were scrolled up */
  const lastHeight = useRef(0)
  const shrankAt = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const [dragFiles, setDragFiles] = useState(false)

  // Typing anywhere in the chat you're working in writes in its message box, and Esc stops
  // Claude, wherever the keyboard is in it: after a click in the conversation, say.
  useEffect(() => {
    if (!active) return
    let downInside = false
    const onDown = (e: PointerEvent): void => {
      downInside = !!root.current?.contains(e.target as Node)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const el = document.activeElement as HTMLElement | null
      const loose = !el || el === document.body
      if (!(loose ? downInside : root.current?.contains(el))) return
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('.confirm-backdrop, .menu, [role="dialog"]')) return
      if (e.key === 'Escape') {
        const status = useStore.getState().chat(tab.id).status
        if (status === 'running' || status === 'starting') {
          e.preventDefault()
          useStore.getState().interrupt(tab.id)
        }
        return
      }
      // A character (AltGr ones too), not a shortcut. Space keeps scrolling the conversation.
      const typed = e.key.length === 1 && e.key !== ' ' && ((!e.ctrlKey && !e.metaKey && !e.altKey) || e.getModifierState('AltGraph'))
      // Focusing the box before the key lands sends the character there.
      if (typed) composers.get(tab.id)?.focus()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [active, tab.id])

  useEffect(() => {
    if (shown && tab.sessionId && chat.historyState === 'none') void s.loadHistory(tab.id)
  }, [shown, tab.sessionId])

  // Focus the message box when this chat becomes the one you're working in, unless a click inside it did that.
  useEffect(() => {
    if (active && !useStore.getState().pointerFocus) setFocusKey((k) => k + 1)
  }, [active])

  const busy = chat.status === 'running' || chat.status === 'starting'
  const visible = useMemo(() => (chat.items.length > limit ? chat.items.slice(-limit) : chat.items), [chat.items, limit])
  const hidden = chat.items.length - visible.length
  const arrived = useArrivals(visible, shown)
  // The time sits over each of your messages, and over Claude's text when the minute has moved on.
  const rows = useMemo(() => {
    let last: string | null = null
    return visible.map((item) => {
      let time: string | null = null
      if (item.kind === 'user' || item.kind === 'assistant') {
        const t = clock(item.ts)
        if (t && (item.kind === 'user' || t !== last)) time = t
        if (t) last = t
      }
      return { item, time }
    })
  }, [visible])

  // Your own message just went in: show it and what comes next, wherever you had scrolled to.
  const lastItem = chat.items[chat.items.length - 1]
  useLayoutEffect(() => {
    if (lastItem?.kind === 'user') stick.current = true
  }, [lastItem?.id])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    // A finished reply replaces the one being written, and for a moment the chat is shorter: the
    // browser then pulls the view to the bottom on its own. That isn't you scrolling down.
    if (!stick.current && el.scrollHeight < lastHeight.current) shrankAt.current = Date.now()
    lastHeight.current = el.scrollHeight
    if (grownFrom.current !== null) {
      // Earlier messages went in above: stay on what you were reading.
      el.scrollTop += el.scrollHeight - grownFrom.current
      grownFrom.current = null
      return
    }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [chat.items, partial, thinking, chat.permissions.length, chat.tasks.length, busy, chat.activity, shown, limit])

  // Scrolling up lets go of the bottom at once, before the next words pull the view back down.
  const letGo = (): void => {
    stick.current = false
  }
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollHeight - el.scrollTop - el.clientHeight
    // Only reaching the very bottom yourself follows new output again.
    if (left < 4 && Date.now() - shrankAt.current > 400) stick.current = true
    const near = left < 80
    if (near !== atBottom) setAtBottom(near)
  }

  const where = project
    ? normPath(tab.cwd) === normPath(project.path)
      ? ''
      : relPath(tab.cwd, project.path)
    : shortPath(tab.cwd, homeDir)
  const empty = !chat.items.length && !busy && chat.historyState !== 'loading'

  return (
    <div
      ref={root}
      className={`chat${dragFiles ? ' drag-files' : ''}`}
      // Files dropped anywhere on the chat go to its message box: images attach, others are mentioned.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || chat.moving) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragFiles) setDragFiles(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragFiles(false)
      }}
      onDrop={(e) => {
        setDragFiles(false)
        if (!e.dataTransfer.files.length || chat.moving) return
        e.preventDefault()
        composers.get(tab.id)?.addFiles([...e.dataTransfer.files])
      }}
    >
      <div className="chat-head thread" data-color={project?.color}>
        <ProjectMark project={project} />
        <span className="chat-head-project" title={tab.cwd}>
          {project?.name ?? 'No project'}
        </span>
        <span className="chat-head-title" title={tab.title}>
          {tab.title}
        </span>
        {where ? <span className="chat-head-path">{where}</span> : null}
        <span className="chat-head-spacer" />
        {chat.activeModel ? <span className="chat-head-meta">{modelName(chat.activeModel, knownModels)}</span> : null}
        <RunControl projectId={tab.projectId} />
        <button className="icon-btn chat-head-tool" title="Open a terminal here" onClick={() => s.newTerminal(tab.projectId)}>
          <SquareTerminal />
        </button>
        {/* A chat in a window of its own has no side panel to show files in. */}
        {!POPOUT_TAB ? (
          <button className="icon-btn chat-head-tool" title="Show files" onClick={() => s.set({ rightPanelOpen: true, rightPanelView: 'files' })}>
            <FolderOpen />
          </button>
        ) : null}
      </div>

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={onScroll}
        onWheel={(e) => e.deltaY < 0 && letGo()}
        onKeyDown={(e) => ['PageUp', 'ArrowUp', 'Home'].includes(e.key) && letGo()}
        onPointerDown={(e) => e.target === e.currentTarget && letGo()}
      >
        <div className="chat-column">
          {chat.historyState === 'loading' ? (
            <div className="history-loading">
              <LoaderCircle className="spin" /> Loading the conversation
            </div>
          ) : null}
          {chat.historyState === 'error' ? <div className="note tone-error"><div className="note-line">This conversation could not be loaded. {chat.error}</div></div> : null}
          {chat.historyState === 'loaded' && chat.historyTotal > chat.items.length && hidden === 0 ? (
            <p className="history-cut">
              This chat is long: it shows its last {chat.items.length.toLocaleString()} of {chat.historyTotal.toLocaleString()} steps. The rest stays in its history file.
            </p>
          ) : null}
          {hidden > 0 ? (
            <button
              className="load-earlier"
              onClick={() => {
                grownFrom.current = scroller.current?.scrollHeight ?? null
                setLimit((l) => l + PAGE)
              }}
            >
              Show earlier messages ({hidden.toLocaleString()})
            </button>
          ) : null}
          {empty ? (
            <div className="chat-empty">
              <h2>{project ? `New chat in ${project.name}` : 'New chat'}</h2>
              <p className="chat-empty-path">{tab.cwd}</p>
              <p>
                Ask for anything in this folder: fix a bug, explain some code, start the dev server, or commit and push your work. Claude
                asks before it changes files, unless you pick another mode below.
              </p>
            </div>
          ) : null}
          {rows.map(({ item, time }) =>
            item.kind === 'user' ? (
              <div key={item.id} ref={arrived.has(item.id) ? rise : undefined} className="turn-user">
                {time ? <div className="turn-time">{time}</div> : null}
                <ChatItemView item={item} cwd={tab.cwd} />
              </div>
            ) : item.kind === 'done' ? (
              <div key={item.id} ref={arrived.has(item.id) ? rise : undefined} className="turn-end">
                <ChatItemView item={item} cwd={tab.cwd} />
                <HoverTime ts={item.ts} />
              </div>
            ) : (
              <div key={item.id} ref={arrived.has(item.id) ? rise : undefined} className={`tl ${timelineClass(item)}${time ? ' has-time' : ''}`}>
                {time ? <div className="turn-time">{time}</div> : null}
                <ChatItemView item={item} cwd={tab.cwd} />
                <HoverTime ts={item.ts} />
              </div>
            )
          )}
          {/* The live rows rise in as they appear; the finished step that replaces one does not. */}
          {thinking ? (
            <div ref={rise} className="tl tl-think tl-live">
              <LiveThinking text={thinking.text} since={thinking.since} />
            </div>
          ) : null}
          {partial ? (
            <div ref={rise} className="tl tl-text">
              <div className="msg-assistant streaming">
                <Markdown text={partial} cwd={tab.cwd} streaming />
              </div>
            </div>
          ) : null}
          {chat.tasks.length ? (
            <div ref={rise} className="tl tl-run tl-agents">
              <AgentTasks tabId={tab.id} tasks={chat.tasks} />
            </div>
          ) : null}
          {(busy || chat.activity === 'compacting') && !partial && !thinking && !chat.permissions.length ? (
            <div ref={rise} className="tl tl-live tl-working">
              <Working since={chat.startedAt} what={chat.activity === 'compacting' ? 'Compacting the conversation' : undefined} />
            </div>
          ) : null}
          {chat.status === 'error' && chat.error && !chat.items.some((i) => i.kind === 'note' && i.tone === 'error') ? (
            <div className="note tone-error">
              <div className="note-line selectable">{chat.error}</div>
            </div>
          ) : null}
          {chat.permissions.map((p) => (
            <div key={p.requestId} ref={rise} className="tl tl-wait">
              <PermissionCard tabId={tab.id} req={p} cwd={tab.cwd} />
            </div>
          ))}
        </div>
      </div>

      <div className="chat-foot">
        {!atBottom ? (
          <button
            className="jump-latest"
            onClick={() => {
              stick.current = true
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
            }}
          >
            <ArrowDown /> Latest
          </button>
        ) : null}
        <Composer tab={tab} focusKey={focusKey} />
      </div>
    </div>
  )
}
