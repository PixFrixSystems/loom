import { Check, ChevronRight, Copy, ImageIcon, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatItem, ImagePreview } from '@shared/types'
import { formatDuration } from '../lib/paths'
import { useStore } from '../store'
import { Markdown } from './Markdown'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** Tools whose input and output are worth seeing without a click: commands and edits. */
const OPEN_BY_DEFAULT = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const TOOL_TITLES: Record<string, string> = {
  Task: 'Agent',
  TodoWrite: 'To-dos',
  ExitPlanMode: 'Plan',
  AskUserQuestion: 'Question',
  MultiEdit: 'Edit',
  NotebookEdit: 'Edit',
  WebFetch: 'Fetch',
  WebSearch: 'Web search'
}

/** The tool's name as the timeline shows it: "Bash", "Read", "playwright: browser click". */
function toolTitle(name: string): string {
  if (TOOL_TITLES[name]) return TOOL_TITLES[name]
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return `${mcp[1].replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ')}: ${mcp[2].replace(/_/g, ' ')}`
  return name
}

/** Re-renders every second while `on`, for live timers. */
function useTick(on: boolean): void {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

/** How long a step took, or has been running. Nothing for steps under a second. */
function StepTime({ ms, title }: { ms: number | undefined; title: string }): ReactNode {
  if (ms === undefined || ms < 1000) return null
  return (
    <span className="tool-time" title={title}>
      {formatDuration(ms)}
    </span>
  )
}

function CopyButton({ text, title = 'Copy' }: { text: string; title?: string }): ReactNode {
  const [done, setDone] = useState(false)
  return (
    <button
      className="icon-btn small io-copy"
      title={done ? 'Copied' : title}
      aria-label={title}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check /> : <Copy />}
    </button>
  )
}

/** One part of a tool's box, what went in or what came out. Long text is cut short until you ask. */
function IoRow({ label, text, lines, tone, copy }: { label: string; text: string; lines: number; tone?: 'err'; copy?: boolean }): ReactNode {
  const pre = useRef<HTMLPreElement>(null)
  const [all, setAll] = useState(false)
  const [cut, setCut] = useState(false)
  // Measured again whenever it changes size: output that arrived while its tab was hidden
  // measures nothing until the tab shows, and a pane's width changes where lines wrap.
  useLayoutEffect(() => {
    const el = pre.current
    if (!el || all) return
    const measure = (): void => setCut(el.scrollHeight > el.clientHeight + 2)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, all])
  return (
    <div className={`io-row${tone ? ` io-${tone}` : ''}`}>
      <span className="io-label">{label}</span>
      <div className="io-main">
        {/* Lines are 1.6em tall in the well, as chat.css sets them. */}
        <pre ref={pre} className={`io-text selectable${cut && !all ? ' is-cut' : ''}`} style={all ? undefined : { maxHeight: `${lines * 1.6}em` }}>
          {text}
        </pre>
        {cut || all ? (
          <button className="io-more" onClick={() => setAll((a) => !a)}>
            {all ? 'Show less' : 'Show all'}
          </button>
        ) : null}
      </div>
      {copy ? <CopyButton text={text} /> : <span />}
    </div>
  )
}

function DiffView({ before, after }: { before: string; after: string }): ReactNode {
  return (
    <div className="diff selectable">
      {before ? <pre className="diff-del">{before}</pre> : null}
      {after ? <pre className="diff-add">{after}</pre> : null}
    </div>
  )
}

export const ToolRow = memo(function ToolRow({ item }: { item: ToolItem }): ReactNode {
  const [open, setOpen] = useState<boolean | null>(null)
  const running = item.status === 'running'
  const failed = item.status === 'error'
  useTick(running && !!item.startedAt)
  const ms = running ? (item.startedAt ? Date.now() - item.startedAt : undefined) : item.ms
  // An edit's "updated successfully" adds nothing; its diff says it all, unless it failed.
  const quietResult = !failed && (!!item.diff || item.name === 'Write')
  const out = item.result && !quietResult ? item.result : ''
  const hasBody = !!(item.detail || item.diff || out || (running && OPEN_BY_DEFAULT.has(item.name)))
  const isOpen = hasBody && (open ?? OPEN_BY_DEFAULT.has(item.name))
  return (
    <div className={`tool${isOpen ? ' open' : ''}${failed ? ' failed' : ''}`}>
      <button className="tool-head" onClick={() => hasBody && setOpen(!isOpen)} aria-expanded={isOpen} disabled={!hasBody}>
        <span className="tool-name">{toolTitle(item.name)}</span>
        <span className="tool-summary">
          {item.filePath ? (
            <span
              className="path-link"
              role="link"
              title="Open in a tab"
              onClick={(e) => {
                e.stopPropagation()
                useStore.getState().openFile(item.filePath!)
              }}
            >
              {item.summary}
            </span>
          ) : (
            item.summary
          )}
        </span>
        <StepTime ms={ms} title={running ? 'Running for' : 'Took'} />
        {hasBody ? <ChevronRight className="tool-chev" /> : null}
      </button>
      {isOpen ? (
        <div className="io">
          {item.detail ? <IoRow label="IN" text={item.detail} lines={3} copy /> : null}
          {item.diff ? (
            <div className="io-diff">
              <DiffView before={item.diff.before} after={item.diff.after} />
            </div>
          ) : null}
          {out ? (
            <IoRow label={failed ? 'ERROR' : 'OUT'} text={out} lines={item.detail ? 6 : 8} tone={failed ? 'err' : undefined} copy />
          ) : running ? (
            <div className="io-row">
              <span className="io-label">OUT</span>
              <span className="io-pending">Running</span>
              <span />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

function Thinking({ text, ms }: { text: string; ms?: number }): ReactNode {
  const [open, setOpen] = useState(false)
  const can = !!text.trim()
  return (
    <div className={`thinking${open ? ' open' : ''}`}>
      <button className="think-head" onClick={() => can && setOpen((o) => !o)} aria-expanded={open} disabled={!can}>
        {ms !== undefined && ms >= 1000 ? `Thought for ${formatDuration(ms)}` : 'Thought'}
        {can ? <ChevronRight className="tool-chev" /> : null}
      </button>
      {open ? <div className="thinking-body selectable">{text}</div> : null}
    </div>
  )
}

// Folding the live thinking holds for the next thought too, until it's opened again.
let liveThinkingOpen = true

/**
 * Claude thinking right now, in place of "Claude is working": a timer from the moment it starts,
 * and the text as its bursts arrive. The finished step replaces it.
 */
export function LiveThinking({ text, since }: { text: string; since?: number }): ReactNode {
  const [open, setOpen] = useState(liveThinkingOpen)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0
  return (
    <div className={`thinking live${open ? ' open' : ''}`}>
      <button
        className="think-head"
        aria-expanded={open}
        disabled={!text}
        onClick={() => {
          liveThinkingOpen = !open
          setOpen(!open)
        }}
      >
        Thinking
        <span className="think-time">{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}</span>
        {text ? <ChevronRight className="tool-chev" /> : null}
      </button>
      {open && text ? (
        <div className="thinking-body selectable">
          {text}
        </div>
      ) : null}
    </div>
  )
}

function Thumbs({ previews }: { previews: ImagePreview[] }): ReactNode {
  return (
    <div className="bubble-thumbs">
      {previews.map((p, i) => (
        <button
          key={i}
          className="bubble-thumb"
          title="Open the image"
          aria-label={`Open image ${i + 1} of ${previews.length}`}
          onClick={() => useStore.getState().set({ viewer: { images: previews, index: i } })}
        >
          {p.thumb ? <img src={p.thumb} alt="" draggable={false} decoding="async" /> : <ImageIcon />}
        </button>
      ))}
    </div>
  )
}

function Note({ item }: { item: Extract<ChatItem, { kind: 'note' }> }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={`note tone-${item.tone}`}>
      <div className="note-line">
        {item.tone === 'error' ? <TriangleAlert /> : null}
        <span className="selectable">{item.text}</span>
        {item.detail ? (
          <button className="note-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : item.tone === 'summary' ? 'Show summary' : 'Details'}
          </button>
        ) : null}
      </div>
      {open && item.detail ? <pre className="note-detail selectable">{item.detail}</pre> : null}
    </div>
  )
}

export const ChatItemView = memo(function ChatItemView({ item, cwd }: { item: ChatItem; cwd: string }): ReactNode {
  switch (item.kind) {
    case 'user': {
      const previews = item.previews ?? []
      const rest = item.images - previews.length
      return (
        <div className="msg-user">
          {previews.length ? <Thumbs previews={previews} /> : null}
          {item.text || rest > 0 ? (
            <div className="bubble selectable">
              {item.text}
              {rest > 0 ? (
                <span className="bubble-images">
                  <ImageIcon /> {rest === 1 ? '1 attachment' : `${rest} attachments`}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )
    }
    case 'assistant':
      return (
        <div className="msg-assistant">
          <Markdown text={item.text} cwd={cwd} />
          <div className="msg-actions">
            <CopyButton text={item.text} title="Copy this reply" />
          </div>
        </div>
      )
    case 'thinking':
      return <Thinking text={item.text} ms={item.ms} />
    case 'tool':
      return <ToolRow item={item} />
    case 'note':
      return <Note item={item} />
    case 'done':
      return <div className="turn-done">Worked for {formatDuration(item.ms)}</div>
  }
})

const STILL = window.matchMedia('(prefers-reduced-motion: reduce)')
const RISE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(4px)' },
  { opacity: 1, transform: 'none' }
]
/** 350ms on the brand's ease-out curve, the same as --ease-out in base.css. */
const RISE_TIMING: KeyframeAnimationOptions = { duration: 350, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }

/**
 * A step arriving in the chat fades in and rises 4px into place. Played with the Web Animations
 * API rather than a CSS animation: a hidden tab is display: none, and showing it again would replay
 * a CSS animation on every step in it.
 */
export function rise(el: HTMLElement | null): void {
  if (el && !STILL.matches) el.animate(RISE, RISE_TIMING)
}

const NO_ARRIVALS = new Set<string>()

/**
 * The steps that have just arrived, to rise in. A chat drawn whole (opened, its history loaded,
 * earlier messages shown) appears as it is, so only a few new steps at a time count. Replies and
 * thoughts are left out: they take the place of the live ones already on screen.
 */
export function useArrivals(items: ChatItem[], shown: boolean): Set<string> {
  const drawn = useRef<Set<string> | null>(null)
  const fresh = useMemo(() => {
    const before = drawn.current
    if (!before || !shown) return NO_ARRIVALS
    const added = items.filter((i) => !before.has(i.id))
    if (!added.length || added.length > 3) return NO_ARRIVALS
    return new Set(added.filter((i) => i.kind !== 'assistant' && i.kind !== 'thinking').map((i) => i.id))
  }, [items, shown])
  useEffect(() => {
    drawn.current = new Set(items.map((i) => i.id))
  }, [items])
  return fresh
}

/** Which dot a step gets on the timeline. */
export function timelineClass(item: ChatItem): string {
  if (item.kind === 'tool') return `tl-tool ${item.status === 'running' ? 'tl-run' : item.status === 'error' ? 'tl-err' : 'tl-ok'}`
  if (item.kind === 'thinking') return 'tl-think'
  if (item.kind === 'note') return `tl-note${item.tone === 'error' ? ' tl-err' : ''}`
  return 'tl-text'
}
