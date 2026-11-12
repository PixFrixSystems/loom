// Turns Claude Code transcript and SDK messages into the small, display-ready items the UI renders.
// Attached images stay in the main process (images.ts); the renderer gets thumbnails and a reference.

import type { ChatItem, ImagePreview } from '@shared/types'
import { keepImage } from './images'

const MAX_RESULT = 8000
const MAX_DETAIL = 8000
const MAX_DIFF = 12000

type Json = Record<string, unknown>

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n(${(text.length - max).toLocaleString()} more characters not shown)`
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function firstLine(text: string, max = 160): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function pretty(input: unknown): string {
  try {
    return truncate(JSON.stringify(input, null, 2), MAX_DETAIL)
  } catch {
    return ''
  }
}

export interface ToolView {
  summary: string
  detail?: string
  diff?: { before: string; after: string }
  filePath?: string
}

export function describeTool(name: string, raw: unknown): ToolView {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Json
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path)
  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(input.command)
      const desc = str(input.description)
      return { summary: desc || firstLine(cmd), detail: truncate(cmd, MAX_DETAIL) }
    }
    case 'Read':
      return { summary: path, filePath: path }
    case 'Write':
      return { summary: path, filePath: path, detail: truncate(str(input.content), MAX_DETAIL) }
    case 'Edit':
      return {
        summary: path,
        filePath: path,
        diff: { before: truncate(str(input.old_string), MAX_DIFF), after: truncate(str(input.new_string), MAX_DIFF) }
      }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Json[]) : []
      return {
        summary: `${path} (${edits.length} edits)`,
        filePath: path,
        diff: {
          before: truncate(edits.map((e) => str(e.old_string)).join('\n…\n'), MAX_DIFF),
          after: truncate(edits.map((e) => str(e.new_string)).join('\n…\n'), MAX_DIFF)
        }
      }
    }
    case 'NotebookEdit':
      return { summary: path, filePath: path, detail: truncate(str(input.new_source), MAX_DETAIL) }
    case 'Glob':
      return { summary: [str(input.pattern), str(input.path)].filter(Boolean).join(' in ') }
    case 'Grep':
      return { summary: [str(input.pattern), str(input.path) || str(input.glob)].filter(Boolean).join(' in ') }
    case 'WebFetch':
      return { summary: str(input.url), detail: str(input.prompt) }
    case 'WebSearch':
      return { summary: str(input.query) }
    case 'Agent':
    case 'Task':
      return { summary: str(input.description) || str(input.subagent_type), detail: truncate(str(input.prompt), MAX_DETAIL) }
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : []
      const done = todos.filter((t) => t.status === 'completed').length
      return {
        summary: `${done} of ${todos.length} done`,
        detail: todos.map((t) => `${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${str(t.content)}`).join('\n')
      }
    }
    case 'Skill':
      return { summary: str(input.skill) || str(input.command) }
    case 'ExitPlanMode':
      return { summary: 'Plan ready for review', detail: truncate(str(input.plan), MAX_DETAIL) }
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? (input.questions as Json[]) : []
      return { summary: qs.map((q) => str(q.question)).join(' / ') }
    }
    default: {
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__')
        return { summary: `${server}: ${tool}`, detail: pretty(input) }
      }
      const firstString = Object.values(input).find((v) => typeof v === 'string') as string | undefined
      return { summary: firstLine(firstString ?? ''), detail: pretty(input) }
    }
  }
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return truncate(content, MAX_RESULT)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as Json[]) {
    if (block.type === 'text') parts.push(str(block.text))
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'document') parts.push('[document]')
  }
  return truncate(parts.join('\n'), MAX_RESULT)
}

const SUMMARY_PREFIXES = [
  'This session is being continued from a previous conversation',
  'This conversation was compacted'
]

/** What Claude Code writes in place of a message when a turn was stopped. */
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/

/**
 * Text Claude Code or an editor adds around what the person typed: reminders, and the file or
 * selection VS Code sends along (ide_opened_file, ide_selection, ide_diagnostics).
 */
function stripTags(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/<artifact-content-authored-by-others\/>/g, '')
    .trim()
}

/** "claude-fable-5-2" as "Fable 5.2", "claude-haiku-4-5-20251001" as "Haiku 4.5". */
export function prettyModel(id: string): string {
  const parts = id.replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '').split('-')
  const name = parts.find((p) => /[a-z]/i.test(p))
  if (!name) return id
  const version = parts.filter((p) => /^\d+$/.test(p)).join('.')
  return `${name[0].toUpperCase()}${name.slice(1)}${version ? ` ${version}` : ''}`
}

/** The model a saved or live assistant message came from, when it is a real Claude model. */
export function messageModel(message: unknown): string | null {
  const model = (message as { model?: unknown } | null)?.model
  return typeof model === 'string' && model.startsWith('claude-') ? model : null
}

export function modelNote(model: string, id: string): ChatItem {
  return { kind: 'note', id: `model:${id}`, tone: 'info', text: `Switched to ${prettyModel(model)}` }
}

function tagValue(text: string, tag: string): string {
  return text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? ''
}

/** A user-side text turn: the person's prompt, or something Claude Code injected in their place. */
export function userTextItem(
  text: string,
  id: string,
  images: number,
  ts?: string,
  synthetic = false,
  previews: ImagePreview[] = []
): ChatItem | null {
  const raw = text.trim()
  if (!raw && !images) return null
  // Markers count only where Claude Code puts them, at the start: a message that merely
  // mentions one (quoting a log, say) is still the person's message.
  const lead = stripTags(raw)
  if (SUMMARY_PREFIXES.some((p) => lead.startsWith(p))) {
    return { kind: 'note', id, tone: 'summary', text: 'Earlier messages were summarized', detail: truncate(lead, 40000) }
  }
  if (INTERRUPTED.test(lead)) return { kind: 'note', id, tone: 'info', text: 'Interrupted' }
  if (/^<command-(name|message|args)>/.test(raw)) {
    const name = tagValue(raw, 'command-name')
    const args = tagValue(raw, 'command-args')
    return { kind: 'user', id, text: `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`, images: 0, ts }
  }
  if (raw.startsWith('<local-command-stdout>') || raw.startsWith('<local-command-stderr>')) {
    const out = tagValue(raw, 'local-command-stdout') || tagValue(raw, 'local-command-stderr')
    return out ? { kind: 'note', id, tone: 'info', text: firstLine(out, 200), detail: truncate(out, MAX_RESULT) } : null
  }
  if (raw.startsWith('<local-command-caveat>')) return null
  if (raw.startsWith('<task-notification>')) {
    const summary = tagValue(raw, 'summary') || 'A background task finished'
    return { kind: 'note', id, tone: 'info', text: firstLine(summary, 200) }
  }
  const clean = stripTags(raw)
  if (!clean && !images) return null
  if (synthetic) return { kind: 'note', id, tone: 'info', text: firstLine(clean, 200), detail: truncate(clean, MAX_RESULT) }
  return { kind: 'user', id, text: clean, images, previews: previews.length ? previews : undefined, ts }
}

export interface ToolResultUpdate {
  toolUseId: string
  result: string
  isError: boolean
}

/** Splits user content into a visible text item (if any) and tool results. */
export function parseUserContent(
  content: unknown,
  id: string,
  ts?: string,
  synthetic = false
): { item: ChatItem | null; results: ToolResultUpdate[] } {
  if (typeof content === 'string') return { item: userTextItem(content, id, 0, ts, synthetic), results: [] }
  if (!Array.isArray(content)) return { item: null, results: [] }
  const texts: string[] = []
  let images = 0
  const previews: ImagePreview[] = []
  const results: ToolResultUpdate[] = []
  for (const block of content as Json[]) {
    if (block.type === 'text') texts.push(str(block.text))
    else if (block.type === 'image') {
      images++
      const src = (block.source ?? {}) as Json
      if (src.type === 'base64' && typeof src.data === 'string') {
        previews.push({ thumb: null, ref: keepImage(str(src.media_type) || 'image/png', src.data) })
      }
    } else if (block.type === 'document') images++
    else if (block.type === 'tool_result') {
      results.push({ toolUseId: str(block.tool_use_id), result: toolResultText(block.content), isError: block.is_error === true })
    }
  }
  const item = texts.length || (images && !results.length) ? userTextItem(texts.join('\n\n'), id, images, ts, synthetic, previews) : null
  return { item, results }
}

/** Assistant content blocks to display items. */
export function assistantItems(content: unknown, idBase: string, ts?: string): ChatItem[] {
  if (!Array.isArray(content)) return []
  const items: ChatItem[] = []
  ;(content as Json[]).forEach((block, i) => {
    if (block.type === 'text') {
      const text = str(block.text)
      if (text.trim()) items.push({ kind: 'assistant', id: `${idBase}:${i}`, text, ts })
    } else if (block.type === 'thinking') {
      const text = str(block.thinking)
      if (text.trim()) items.push({ kind: 'thinking', id: `${idBase}:${i}`, text: truncate(text, MAX_DETAIL) })
    } else if (block.type === 'tool_use') {
      const name = str(block.name)
      const view = describeTool(name, block.input)
      items.push({ kind: 'tool', id: str(block.id) || `${idBase}:${i}`, name, status: 'running', ...view })
    }
  })
  return items
}

interface HistoryMessage {
  type: string
  uuid: string
  message?: unknown
  parent_tool_use_id: string | null
  timestamp?: string
  origin?: { kind?: string }
}

/**
 * Converts a saved conversation (SDK getSessionMessages output) into display items. Every saved
 * step has a timestamp, which gives the timings: thinking ran from the previous step to the
 * thought, a tool from its call to its result, a turn from the prompt to its last step.
 */
export function historyToItems(messages: HistoryMessage[]): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  const toolStart = new Map<string, number>()
  let prev = NaN
  let turnStart = NaN
  let turnEnd = NaN
  let model = ''
  const endTurn = (): void => {
    if (turnEnd - turnStart >= 1000) items.push({ kind: 'done', id: `done:${turnStart}`, ms: turnEnd - turnStart })
    turnStart = NaN
    turnEnd = NaN
  }
  for (const m of messages) {
    if (m.parent_tool_use_id) continue
    const msg = (m.message ?? {}) as Json
    const at = m.timestamp ? Date.parse(m.timestamp) : NaN
    if (m.type === 'assistant') {
      // A reply from another model than the one before: say so above it.
      const from = messageModel(msg)
      if (from) {
        if (model && from !== model) items.push(modelNote(from, m.uuid))
        model = from
      }
      for (const item of assistantItems(msg.content, m.uuid, m.timestamp)) {
        if (item.kind === 'thinking' && at - prev > 0) item.ms = at - prev
        if (item.kind === 'tool') {
          item.status = 'done'
          tools.set(item.id, item)
          if (!Number.isNaN(at)) toolStart.set(item.id, at)
        }
        items.push(item)
      }
    } else if (m.type === 'user') {
      const synthetic = !!m.origin?.kind && m.origin.kind !== 'human'
      const { item, results } = parseUserContent(msg.content, m.uuid, m.timestamp, synthetic)
      for (const r of results) {
        const tool = tools.get(r.toolUseId)
        if (tool) {
          tool.result = r.result
          tool.isError = r.isError
          tool.status = r.isError ? 'error' : 'done'
          const start = toolStart.get(r.toolUseId)
          if (start !== undefined && at - start >= 0) tool.ms = at - start
        }
      }
      if (item?.kind === 'user') {
        endTurn()
        turnStart = at
      }
      if (item) items.push(item)
    }
    if (!Number.isNaN(at)) {
      prev = at
      if (!Number.isNaN(turnStart)) turnEnd = at
    }
  }
  endTurn()
  return items
}
