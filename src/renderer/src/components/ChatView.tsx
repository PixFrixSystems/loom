import { ArrowDown, FolderOpen, LoaderCircle, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatTab } from '@shared/types'
import { normPath, relPath, shortPath } from '../lib/paths'
import { EMPTY_CHAT, modelName, useLive, useStore } from '../store'
import { AgentTasks } from './AgentTasks'
import { ChatItemView, LiveThinking, timelineClass } from './ChatItems'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import { PermissionCard } from './PermissionCard'
import { ProjectMark } from './ProjectMark'
import { RunControl } from './Servers'

const PAGE = 200

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

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

function Working({ since }: { since?: number }): ReactNode {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0
  const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
  return (
    <div className="working" role="status">
      <span className="shuttle" aria-hidden="true">
        <span />
      </span>
      <span>Claude is working</span>
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
    if (grownFrom.current !== null) {
      // Earlier messages went in above: stay on what you were reading.
      el.scrollTop += el.scrollHeight - grownFrom.current
      grownFrom.current = null
      return
    }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [chat.items, partial, thinking, chat.permissions.length, chat.tasks.length, busy, shown, limit])

  // Scrolling up lets go of the bottom at once, before the next words pull the view back down.
  const letGo = (): void => {
    stick.current = false
  }
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollHeight - el.scrollTop - el.clientHeight
    // Only reaching the very bottom follows new output again.
    if (left < 4) stick.current = true
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
    <div className="chat">
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
        <button className="icon-btn" title="Open a terminal here" onClick={() => s.newTerminal(tab.projectId)}>
          <SquareTerminal />
        </button>
        <button className="icon-btn" title="Show files" onClick={() => s.set({ rightPanelOpen: true, rightPanelView: 'files' })}>
          <FolderOpen />
        </button>
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
              <div key={item.id} className="turn-user">
                {time ? <div className="turn-time">{time}</div> : null}
                <ChatItemView item={item} cwd={tab.cwd} />
              </div>
            ) : item.kind === 'done' ? (
              <ChatItemView key={item.id} item={item} cwd={tab.cwd} />
            ) : (
              <div key={item.id} className={`tl ${timelineClass(item)}${time ? ' has-time' : ''}`}>
                {time ? <div className="turn-time">{time}</div> : null}
                <ChatItemView item={item} cwd={tab.cwd} />
              </div>
            )
          )}
          {thinking ? (
            <div className="tl tl-run tl-thinking-live">
              <LiveThinking text={thinking.text} since={thinking.since} />
            </div>
          ) : null}
          {partial ? (
            <div className="tl tl-text">
              <div className="msg-assistant streaming">
                <Markdown text={partial} cwd={tab.cwd} streaming />
              </div>
            </div>
          ) : null}
          {chat.tasks.length ? (
            <div className="tl tl-run tl-agents">
              <AgentTasks tabId={tab.id} tasks={chat.tasks} />
            </div>
          ) : null}
          {busy && !partial && !thinking && !chat.permissions.length ? (
            <div className="tl tl-run tl-working">
              <Working since={chat.startedAt} />
            </div>
          ) : null}
          {chat.status === 'error' && chat.error && !chat.items.some((i) => i.kind === 'note' && i.tone === 'error') ? (
            <div className="note tone-error">
              <div className="note-line selectable">{chat.error}</div>
            </div>
          ) : null}
          {chat.permissions.map((p) => (
            <div key={p.requestId} className="tl tl-wait">
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
