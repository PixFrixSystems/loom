// A chat's steps as the phone shows them: messages, thoughts, tool runs and notes, in the same
// order and with the same words as Loom on the PC, sized for a thumb.

import { ChevronRight, ImageIcon, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { ChatItem } from '@shared/types'
import { formatDuration } from '@renderer/lib/paths'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

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

/** The tool's name as Loom shows it: "Bash", "Read", "playwright: browser click". */
export function toolTitle(name: string): string {
  if (TOOL_TITLES[name]) return TOOL_TITLES[name]
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return `${mcp[1].replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ')}: ${mcp[2].replace(/_/g, ' ')}`
  return name
}

const MD: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wide tables scroll inside their own box instead of pushing the page sideways.
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={MD}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

/** Re-renders every second while `on`, for running timers. */
export function useTick(on: boolean): void {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

/** Long input or output: a few lines, and the rest when asked. */
function Well({ label, text, tone }: { label: string; text: string; tone?: 'err' }): ReactNode {
  const long = text.length > 600 || text.split('\n').length > 10
  const [all, setAll] = useState(false)
  return (
    <div className={`well${tone ? ` is-${tone}` : ''}`}>
      <div className="well-label">{label}</div>
      <pre className={long && !all ? 'is-cut' : undefined}>{text}</pre>
      {long ? (
        <button className="well-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </div>
  )
}

export function Diff({ before, after }: { before: string; after: string }): ReactNode {
  return (
    <div className="diff">
      {before ? <pre className="diff-del">{before}</pre> : null}
      {after ? <pre className="diff-add">{after}</pre> : null}
    </div>
  )
}

const Tool = memo(function Tool({ item }: { item: ToolItem }): ReactNode {
  const [open, setOpen] = useState(false)
  const running = item.status === 'running'
  const failed = item.status === 'error'
  useTick(running && !!item.startedAt)
  const ms = running ? (item.startedAt ? Date.now() - item.startedAt : undefined) : item.ms
  // An edit's "updated successfully" adds nothing next to its diff, unless it failed.
  const out = item.result && (failed || !(item.diff || item.name === 'Write')) ? item.result : ''
  const hasBody = !!(item.detail || item.diff || out)
  return (
    <div className={`tool${failed ? ' is-failed' : ''}${running ? ' is-running' : ''}`}>
      <button className="tool-head" onClick={() => hasBody && setOpen((o) => !o)} aria-expanded={hasBody ? open : undefined} disabled={!hasBody}>
        <span className={`tool-dot${running ? ' live-dot' : ''}`} />
        <span className="tool-name">{toolTitle(item.name)}</span>
        <span className="tool-summary">{item.summary}</span>
        {ms !== undefined && ms >= 1000 ? <span className="tool-time">{formatDuration(ms)}</span> : null}
        {hasBody ? <ChevronRight className={`chev${open ? ' is-open' : ''}`} /> : null}
      </button>
      {open ? (
        <div className="tool-body">
          {item.detail ? <Well label="In" text={item.detail} /> : null}
          {item.diff ? <Diff before={item.diff.before} after={item.diff.after} /> : null}
          {out ? <Well label={failed ? 'Error' : 'Out'} text={out} tone={failed ? 'err' : undefined} /> : null}
        </div>
      ) : null}
    </div>
  )
})

function Thought({ text, ms }: { text: string; ms?: number }): ReactNode {
  const [open, setOpen] = useState(false)
  const can = !!text.trim()
  return (
    <div className="thought">
      <button className="thought-head" onClick={() => can && setOpen((o) => !o)} aria-expanded={can ? open : undefined} disabled={!can}>
        {ms !== undefined && ms >= 1000 ? `Thought for ${formatDuration(ms)}` : 'Thought'}
        {can ? <ChevronRight className={`chev${open ? ' is-open' : ''}`} /> : null}
      </button>
      {open ? <div className="thought-body">{text}</div> : null}
    </div>
  )
}

/** Claude thinking right now: a timer from the moment it started, and the text when asked. */
export function LiveThought({ text, since }: { text: string; since: number }): ReactNode {
  const [open, setOpen] = useState(false)
  useTick(true)
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return (
    <div className="thought is-live">
      <button className="thought-head" onClick={() => text && setOpen((o) => !o)} aria-expanded={text ? open : undefined} disabled={!text}>
        <span className="live-dot" />
        Thinking
        <span className="thought-time">{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}</span>
        {text ? <ChevronRight className={`chev${open ? ' is-open' : ''}`} /> : null}
      </button>
      {open && text ? <div className="thought-body">{text}</div> : null}
    </div>
  )
}

function Note({ item }: { item: Extract<ChatItem, { kind: 'note' }> }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={`note is-${item.tone}`}>
      <div className="note-line">
        {item.tone === 'error' ? <TriangleAlert /> : null}
        <span>{item.text}</span>
        {item.detail ? (
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : item.tone === 'summary' ? 'Show summary' : 'Details'}
          </button>
        ) : null}
      </div>
      {open && item.detail ? <pre className="note-detail">{item.detail}</pre> : null}
    </div>
  )
}

export const Step = memo(function Step({ item, pending }: { item: ChatItem; pending?: boolean }): ReactNode {
  switch (item.kind) {
    case 'user': {
      const thumbs = (item.previews ?? []).filter((p) => p.thumb)
      const rest = item.images - thumbs.length
      return (
        <div className={`said${pending ? ' is-pending' : ''}`}>
          {thumbs.length ? (
            <div className="said-thumbs">
              {thumbs.map((p, i) => (
                <img key={i} src={p.thumb!} alt="" decoding="async" />
              ))}
            </div>
          ) : null}
          {item.text || rest > 0 ? (
            <div className="bubble">
              {item.text}
              {rest > 0 ? (
                <span className="bubble-images">
                  <ImageIcon /> {rest === 1 ? '1 attachment' : `${rest} attachments`}
                </span>
              ) : null}
            </div>
          ) : null}
          {pending ? <div className="said-state">Sending</div> : null}
        </div>
      )
    }
    case 'assistant':
      return <Markdown text={item.text} />
    case 'thinking':
      return <Thought text={item.text} ms={item.ms} />
    case 'tool':
      return <Tool item={item} />
    case 'note':
      return <Note item={item} />
    case 'done':
      return <div className="turn-done">Worked for {formatDuration(item.ms)}</div>
  }
})
