import { ArrowDown, FolderOpen, LoaderCircle, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatTab } from '@shared/types'
import { normPath, relPath, shortPath } from '../lib/paths'
import { modelName, useStore } from '../store'
import { ChatItemView, LiveThinking, timelineClass } from './ChatItems'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import { PermissionCard } from './PermissionCard'
import { ProjectMark } from './ProjectMark'
import { RunControl } from './Servers'

const PAGE = 200

function clock(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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
  const s = useStore()
  const chat = s.chat(tab.id)
  const project = s.projects.find((p) => p.id === tab.projectId)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [focusKey, setFocusKey] = useState(0)

  useEffect(() => {
    if (shown && tab.sessionId && chat.historyState === 'none') void s.loadHistory(tab.id)
  }, [shown, tab.sessionId])

  // Focus the message box when this chat becomes the one you're working in, unless a click inside it did that.
  useEffect(() => {
    if (active && !useStore.getState().pointerFocus) setFocusKey((k) => k + 1)
  }, [active])

  const busy = chat.status === 'running' || chat.status === 'starting'
  const visible = chat.items.length > limit ? chat.items.slice(-limit) : chat.items
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

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.items, chat.partial, chat.thinking, chat.permissions.length, busy, shown])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    if (near !== atBottom) setAtBottom(near)
  }

  const where = project
    ? normPath(tab.cwd) === normPath(project.path)
      ? ''
      : relPath(tab.cwd, project.path)
    : shortPath(tab.cwd, s.info?.homeDir)
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
        {chat.activeModel ? <span className="chat-head-meta">{modelName(chat.activeModel, s.knownModels)}</span> : null}
        <RunControl projectId={tab.projectId} />
        <button className="icon-btn" title="Open a terminal here" onClick={() => s.newTerminal(tab.projectId)}>
          <SquareTerminal />
        </button>
        <button className="icon-btn" title="Show files" onClick={() => s.set({ rightPanelOpen: true, rightPanelView: 'files' })}>
          <FolderOpen />
        </button>
      </div>

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat-column">
          {chat.historyState === 'loading' ? (
            <div className="history-loading">
              <LoaderCircle className="spin" /> Loading the conversation
            </div>
          ) : null}
          {chat.historyState === 'error' ? <div className="note tone-error"><div className="note-line">This conversation could not be loaded. {chat.error}</div></div> : null}
          {hidden > 0 ? (
            <button className="load-earlier" onClick={() => setLimit((l) => l + PAGE)}>
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
          {chat.thinking ? (
            <div className="tl tl-run tl-thinking-live">
              <LiveThinking text={chat.thinking.text} since={chat.thinking.since} />
            </div>
          ) : null}
          {chat.partial ? (
            <div className="tl tl-text">
              <div className="msg-assistant streaming">
                <Markdown text={chat.partial} cwd={tab.cwd} />
              </div>
            </div>
          ) : null}
          {busy && !chat.partial && !chat.thinking && !chat.permissions.length ? (
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
