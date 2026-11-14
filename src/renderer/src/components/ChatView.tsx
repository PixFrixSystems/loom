import { ArrowDown, ChevronDown, ChevronUp, FolderOpen, LoaderCircle, SquareTerminal } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentTask, ChatTab } from '@shared/types'
import { normPath, relPath, shortPath } from '../lib/paths'
import { EMPTY_CHAT, modelName, POPOUT_TAB, useLive, useStore } from '../store'
import { AgentsButton, AgentTasks } from './AgentTasks'
import { ChatItemView, ChatTabContext, LiveThinking, rise, timelineClass, useArrivals } from './ChatItems'
import { Composer, composers } from './Composer'
import { Markdown } from './Markdown'
import { PermissionCard } from './PermissionCard'
import { ProjectMark } from './ProjectMark'
import { RunControl } from './Servers'

const PAGE = 200
/** The pinned band's height: a message of yours ending above this line is out of view, under the band. */
const PIN_COVER = 42

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

/** When a message was sent: the time today, the date and time before that. */
function sentAt(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return (d.toDateString() === new Date().toDateString() ? CLOCK : DAY).format(d)
}

interface Pinned {
  id: string
  /** Its place among your messages on show, and how many there are */
  index: number
  count: number
}

/**
 * Your message for the part of the conversation on screen, pinned at the top once it has scrolled
 * away: you always see what you asked, even coming back to a chat days later at its bottom.
 * Clicking it goes back to the message; the arrows step to the one before or after.
 */
function PinnedPrompt({ text, images, ts, pinned, onReveal, onStep }: { text: string; images: number; ts?: string; pinned: Pinned; onReveal: () => void; onStep: (dir: -1 | 1) => void }): ReactNode {
  const words = text.replace(/\s+/g, ' ').trim() || (images === 1 ? 'An image' : `${images} images`)
  const when = sentAt(ts)
  return (
    <div className="pinned-slot">
      <div className="pinned-prompt">
        <div className="pinned-row">
          <div className="pinned-nav">
            {when ? <span className="pinned-when">{when}</span> : null}
            <button className="icon-btn small" title="Your message before this one" aria-label="Your message before this one" disabled={pinned.index === 0} onClick={() => onStep(-1)}>
              <ChevronUp />
            </button>
            <button className="icon-btn small" title="Your next message" aria-label="Your next message" disabled={pinned.index >= pinned.count - 1} onClick={() => onStep(1)}>
              <ChevronDown />
            </button>
          </div>
          <button className="pinned-text" title={text.length > 600 ? `${text.slice(0, 600)}…` : text || 'Show this message'} onClick={onReveal}>
            <span>{words}</span>
          </button>
        </div>
      </div>
    </div>
  )
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
  const [pinned, setPinned] = useState<Pinned | null>(null)
  const pinFrame = useRef(0)

  // Which of your messages the part on screen belongs to: the last one starting above the top. It
  // is pinned while it is out of view, and not while you can see it.
  const findPinned = (): void => {
    cancelAnimationFrame(pinFrame.current)
    pinFrame.current = requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      const line = el.getBoundingClientRect().top + PIN_COVER
      const prompts = el.querySelectorAll<HTMLElement>('[data-prompt]')
      let index = -1
      for (let i = 0; i < prompts.length && prompts[i].getBoundingClientRect().top < line; i++) index = i
      const away = index >= 0 && prompts[index].getBoundingClientRect().bottom <= line
      const next = away ? { id: prompts[index].dataset.prompt!, index, count: prompts.length } : null
      setPinned((p) => (p?.id === next?.id && p?.index === next?.index && p?.count === next?.count ? p : next))
    })
  }
  useEffect(() => () => cancelAnimationFrame(pinFrame.current), [])

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

  // Agents and background tasks sit in the timeline where they started, after the step that was
  // the latest then, and scroll away with it like any other step. The header's Agents button and
  // the status bar keep saying they run. '' holds the ones that started before the steps on show.
  const agentsAfter = useMemo(() => {
    const at = new Map<string, AgentTask[]>()
    for (const task of chat.tasks) {
      let anchor = ''
      for (const { item } of rows) {
        // A second's grace: the step that started it can be stamped a moment after the task itself.
        if (item.ts && Date.parse(item.ts) <= task.startedAt + 1000) anchor = item.id
      }
      at.set(anchor, [...(at.get(anchor) ?? []), task])
    }
    return at
  }, [chat.tasks, rows])
  const agentsRow = (tasks: AgentTask[] | undefined): ReactNode =>
    tasks?.length ? (
      <div ref={rise} className="tl tl-run tl-agents">
        <AgentTasks tabId={tab.id} tasks={tasks} />
      </div>
    ) : null

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

  // What is on screen changes with the content as well as with scrolling.
  useEffect(() => {
    if (shown) findPinned()
  }, [chat.items, shown, limit, partial])

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
    findPinned()
  }

  const promptEl = (index: number): HTMLElement | undefined => scroller.current?.querySelectorAll<HTMLElement>('[data-prompt]')[index]
  /** Back to the pinned message itself, lit for a moment so the eye finds it. */
  const revealPrompt = (): void => {
    const el = scroller.current
    const target = pinned ? promptEl(pinned.index) : undefined
    if (!el || !target) return
    letGo()
    el.scrollTo({ top: el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12, behavior: 'smooth' })
    const bubble = target.querySelector('.bubble')
    bubble?.classList.remove('flash')
    void (bubble as HTMLElement | null)?.offsetWidth
    bubble?.classList.add('flash')
  }
  /**
   * To the message before or after: scrolled to just past it, so what Claude did next starts below
   * the band and the message itself is the one pinned. The arrows can be pressed again and again.
   */
  const stepPrompt = (dir: -1 | 1): void => {
    const el = scroller.current
    const target = pinned ? promptEl(pinned.index + dir) : undefined
    if (!el || !target) return
    letGo()
    // The message ends right under the band's lower edge, hidden by it, and the answer follows.
    const top = el.getBoundingClientRect().top
    const band = el.querySelector('.pinned-prompt')?.getBoundingClientRect().bottom ?? top + PIN_COVER
    el.scrollTo({ top: el.scrollTop + target.getBoundingClientRect().bottom - band + 1, behavior: 'smooth' })
  }
  const pinnedItem = pinned ? chat.items.find((i) => i.id === pinned.id) : undefined

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
      // Files dropped on the message box go into the message: images attach, others are mentioned.
      // Dropped anywhere else on the chat, images still attach (a screenshot is for Claude) and
      // other files open in tabs, as they do everywhere in Loom.
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
        // Handled here: the window's own drop handling leaves it alone.
        e.stopPropagation()
        useStore.setState({ fileDrag: false })
        const files = [...e.dataTransfer.files]
        const onBox = !!(e.target as HTMLElement).closest('.chat-foot')
        const forMessage = onBox ? files : files.filter((f) => f.type.startsWith('image/'))
        const toOpen = onBox ? [] : files.filter((f) => !f.type.startsWith('image/'))
        if (forMessage.length) composers.get(tab.id)?.addFiles(forMessage)
        if (toOpen.length) void useStore.getState().openPaths(toOpen.map((f) => window.loom.pathForFile(f)), { x: e.clientX, y: e.clientY })
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
        <AgentsButton tabId={tab.id} tasks={chat.tasks} />
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
        {pinned && pinnedItem?.kind === 'user' ? (
          <PinnedPrompt text={pinnedItem.text} images={pinnedItem.images ?? 0} ts={pinnedItem.ts} pinned={pinned} onReveal={revealPrompt} onStep={stepPrompt} />
        ) : null}
        <ChatTabContext.Provider value={tab.id}>
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
            {agentsRow(agentsAfter.get(''))}
            {rows.map(({ item, time }) => (
              <Fragment key={item.id}>
                {item.kind === 'user' ? (
                  <div ref={arrived.has(item.id) ? rise : undefined} className="turn-user" data-prompt={item.id}>
                    {time ? <div className="turn-time">{time}</div> : null}
                    <ChatItemView item={item} cwd={tab.cwd} />
                  </div>
                ) : item.kind === 'done' ? (
                  <div ref={arrived.has(item.id) ? rise : undefined} className="turn-end">
                    <ChatItemView item={item} cwd={tab.cwd} />
                    <HoverTime ts={item.ts} />
                  </div>
                ) : (
                  <div ref={arrived.has(item.id) ? rise : undefined} className={`tl ${timelineClass(item)}${time ? ' has-time' : ''}`}>
                    {time ? <div className="turn-time">{time}</div> : null}
                    <ChatItemView item={item} cwd={tab.cwd} />
                    <HoverTime ts={item.ts} />
                  </div>
                )}
                {agentsRow(agentsAfter.get(item.id))}
              </Fragment>
            ))}
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
        </ChatTabContext.Provider>
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
