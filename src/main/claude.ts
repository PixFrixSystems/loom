import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, promises as fsp, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import type {
  CanUseTool,
  ModelInfo,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ChatEvent,
  ChatStartOptions,
  ChatStatus,
  ClaudeInfo,
  ContextInfo,
  EffortLevel,
  HistoryResult,
  ImageAttachment,
  LoomSettings,
  ModelOption,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  Question,
  SessionSummary,
  SlashCommandInfo
} from '@shared/types'
import { assistantItems, describeTool, historyToItems, parseUserContent, truncate } from './convert'
import { fillThumbnails } from './images'

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<Sdk> | null = null

export function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

// ---------- Which claude.exe runs the chats ----------

function bundledClaudePath(): string | null {
  try {
    const pkgDir = join(require.resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json'), '..')
    const exe = join(pkgDir, 'claude.exe').replace('app.asar', 'app.asar.unpacked')
    return existsSync(exe) ? exe : null
  } catch {
    return null
  }
}

let installedCache: string | null | undefined
function installedClaudePath(): string | null {
  if (installedCache !== undefined) return installedCache
  const candidates = [join(homedir(), '.local', 'bin', 'claude.exe')]
  try {
    const out = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
    candidates.unshift(...out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.toLowerCase().endsWith('.exe')))
  } catch {
    // not on PATH
  }
  installedCache = candidates.find((p) => existsSync(p)) ?? null
  return installedCache
}

function defaultEffort(): EffortLevel | null {
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as { effortLevel?: string }
    return ['low', 'medium', 'high', 'xhigh', 'max'].includes(s.effortLevel ?? '') ? (s.effortLevel as EffortLevel) : null
  } catch {
    return null
  }
}

export function claudeInfo(): ClaudeInfo {
  return {
    bundledPath: bundledClaudePath(),
    installedPath: installedClaudePath(),
    homeDir: homedir(),
    claudeDir: join(homedir(), '.claude'),
    defaultEffort: defaultEffort()
  }
}

export function executableFor(settings: LoomSettings): string | undefined {
  if (settings.claudeSource === 'installed') return installedClaudePath() ?? undefined
  if (settings.claudeSource === 'custom' && settings.claudeCustomPath.trim()) return settings.claudeCustomPath.trim()
  return bundledClaudePath() ?? undefined
}

// ---------- Saved conversations ----------

let sessionCache: { at: number; list: SessionSummary[] } | null = null
const cwdCache = new Map<string, string | null>()

async function transcriptIndex(): Promise<Map<string, string>> {
  const root = join(homedir(), '.claude', 'projects')
  const index = new Map<string, string>()
  let dirs: string[] = []
  try {
    dirs = await fsp.readdir(root)
  } catch {
    return index
  }
  await Promise.all(
    dirs.map(async (d) => {
      try {
        for (const f of await fsp.readdir(join(root, d))) if (f.endsWith('.jsonl')) index.set(f.slice(0, -6), join(root, d, f))
      } catch {
        // not a folder
      }
    })
  )
  return index
}

/** The SDK only looks for the folder in the first 64 KB; some chats record it later. Read further. */
async function findCwd(path: string): Promise<string | null> {
  const CHUNK = 512 * 1024
  const LIMIT = 16 * 1024 * 1024
  let fh: fsp.FileHandle | null = null
  try {
    fh = await fsp.open(path, 'r')
    const buf = Buffer.alloc(CHUNK)
    let carry = ''
    for (let pos = 0; pos < LIMIT; pos += CHUNK) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos)
      if (!bytesRead) break
      const text = carry + buf.toString('utf8', 0, bytesRead)
      const m = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
      if (m) return JSON.parse(`"${m[1]}"`) as string
      carry = text.slice(-2048)
    }
  } catch {
    // unreadable; leave it out
  } finally {
    await fh?.close()
  }
  return null
}

export async function listAllSessions(force = false): Promise<SessionSummary[]> {
  if (!force && sessionCache && Date.now() - sessionCache.at < 4000) return sessionCache.list
  const sdk = await loadSdk()
  const raw = await sdk.listSessions()
  const missing = raw.filter((s) => !s.cwd && !cwdCache.has(s.sessionId))
  if (missing.length) {
    const index = await transcriptIndex()
    await Promise.all(
      missing.map(async (s) => {
        const path = index.get(s.sessionId)
        cwdCache.set(s.sessionId, path ? await findCwd(path) : null)
      })
    )
  }
  for (const s of raw) if (!s.cwd) s.cwd = cwdCache.get(s.sessionId) ?? undefined
  const list: SessionSummary[] = raw
    .filter((s) => !!s.cwd)
    .map((s) => ({
      sessionId: s.sessionId,
      title: (s.customTitle || s.summary || s.firstPrompt || 'Untitled chat').replace(/\s+/g, ' ').trim(),
      cwd: s.cwd!,
      lastModified: s.lastModified,
      createdAt: s.createdAt,
      gitBranch: s.gitBranch,
      fileSize: s.fileSize
    }))
    .sort((a, b) => b.lastModified - a.lastModified)
  sessionCache = { at: Date.now(), list }
  return list
}

const HISTORY_LIMIT = 1500

/** The window and summary reserve Claude last reported (every current model: 1M and 33k). */
let learnedWindow = { max: 1_000_000, buffer: 33_000 }

/** A saved chat's fullness: what its last response took in and gave out. */
function contextFromHistory(messages: unknown[]): ContextInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { type?: string; parent_tool_use_id?: string | null; message?: { usage?: Record<string, number> } }
    if (m.type !== 'assistant' || m.parent_tool_use_id) continue
    const u = m.message?.usage
    if (!u) continue
    const used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
    if (used > 0) return { used, ...learnedWindow, estimated: true }
  }
  return undefined
}

/** A command as the menu shows it: Claude Code labels a skill's source in brackets at the end. */
function toCommandInfo(c: SlashCommand): SlashCommandInfo {
  const m = c.description.match(/\s*\(([^()]+)\)\s*$/)
  return {
    name: c.name,
    description: m ? c.description.slice(0, m.index).trim() : c.description,
    builtin: c.builtin === true,
    source: m ? m[1] : undefined
  }
}

const commandCache = new Map<string, { at: number; list: Promise<SlashCommandInfo[]> }>()

/**
 * The commands and skills a chat in this folder would have, before any chat starts there.
 * Starts Claude Code without sending anything, asks, and stops it: well under a second.
 */
export function commandsFor(cwd: string, settings: LoomSettings): Promise<SlashCommandInfo[]> {
  const key = cwd.toLowerCase()
  const hit = commandCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list
  const list = (async () => {
    const sdk = await loadSdk()
    let stop: (() => void) | null = null
    const idle: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SDKUserMessage>>((r) => (stop = () => r({ done: true, value: undefined }))) })
    }
    const abort = new AbortController()
    try {
      const q = sdk.query({
        prompt: idle,
        options: {
          cwd,
          abortController: abort,
          persistSession: false,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          pathToClaudeCodeExecutable: executableFor(settings)
        }
      })
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 20_000))
      return (await Promise.race([q.supportedCommands(), timeout])).map(toCommandInfo)
    } finally {
      ;(stop as (() => void) | null)?.()
      abort.abort()
    }
  })()
  commandCache.set(key, { at: Date.now(), list })
  list.catch(() => commandCache.delete(key))
  return list
}

export async function loadHistory(sessionId: string): Promise<HistoryResult> {
  try {
    const sdk = await loadSdk()
    const messages = await sdk.getSessionMessages(sessionId, { includeSystemMessages: false })
    const items = historyToItems(messages as Parameters<typeof historyToItems>[0])
    const total = items.length
    const shown = total > HISTORY_LIMIT ? items.slice(-HISTORY_LIMIT) : items
    fillThumbnails(shown)
    return { items: shown, total, context: contextFromHistory(messages) }
  } catch (e) {
    return { items: [], total: 0, error: (e as Error).message }
  }
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const sdk = await loadSdk()
  await sdk.renameSession(sessionId, title)
  sessionCache = null
}

// ---------- Live chats ----------

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = []
  private closed = false

  push(item: SDKUserMessage): void {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: item, done: false })
    else this.items.push(item)
  }

  close(): void {
    this.closed = true
    for (const w of this.waiters) w({ value: undefined, done: true })
    this.waiters = []
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

function modelOptions(models: ModelInfo[]): ModelOption[] {
  return models.map((m) => ({
    value: m.value === 'default' ? '' : m.value,
    label: m.displayName || m.value,
    description: m.description,
    resolved: m.resolvedModel,
    efforts: m.supportedEffortLevels as EffortLevel[] | undefined
  }))
}

class ChatSession {
  private q: Query | null = null
  private queue: InputQueue | null = null
  private abort: AbortController | null = null
  private pending = new Map<string, (r: PermissionResponse) => void>()
  private partial = ''
  private partialTimer: NodeJS.Timeout | null = null
  /** When the last step happened (prompt sent, message arrived, tool finished): thinking runs from here. */
  private mark = Date.now()
  private toolStarts = new Map<string, number>()
  private stderrTail = ''
  private closed = false
  sessionId: string | null

  constructor(
    private web: WebContents,
    readonly tabId: string,
    private opts: ChatStartOptions,
    private readonly settings: () => LoomSettings,
    private readonly onTurnDone: (tabId: string, error?: string) => void
  ) {
    this.sessionId = opts.sessionId
  }

  /** Events kept back while the tab moves between windows, so none land in the window it is leaving. */
  private held: ChatEvent[] | null = null

  hold(): void {
    this.held ??= []
  }

  /** Points the chat at another window and sends it whatever was held back on the way. */
  rebind(web: WebContents): void {
    this.web = web
    const held = this.held
    this.held = null
    for (const event of held ?? []) this.emit(event)
  }

  private emit(event: ChatEvent): void {
    if (this.held) {
      this.held.push(event)
      return
    }
    if (!this.web.isDestroyed()) this.web.send('chat:event', this.tabId, event)
  }

  private setStatus(status: ChatStatus, error?: string): void {
    this.emit({ type: 'status', status, error })
  }

  get running(): boolean {
    return this.q !== null
  }

  get query(): Query | null {
    return this.q
  }

  private async start(): Promise<void> {
    const sdk = await loadSdk()
    this.queue = new InputQueue()
    this.abort = new AbortController()
    this.stderrTail = ''
    const settings = this.settings()
    const mode = this.opts.permissionMode ?? settings.defaultPermissionMode ?? undefined
    const options: Options = {
      cwd: this.opts.cwd,
      resume: this.sessionId ?? undefined,
      model: this.opts.model || undefined,
      permissionMode: mode,
      effort: this.opts.effort ?? undefined,
      settings: this.opts.ultracode ? { ultracode: true } : undefined,
      allowDangerouslySkipPermissions: true,
      canUseTool: this.canUseTool,
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      abortController: this.abort,
      pathToClaudeCodeExecutable: executableFor(settings),
      stderr: (data) => {
        this.stderrTail = (this.stderrTail + data).slice(-4000)
      }
    }
    this.q = sdk.query({ prompt: this.queue, options })
    void this.pump(this.q)
  }

  private async pump(q: Query): Promise<void> {
    let failure: string | undefined
    try {
      for await (const message of q) this.handle(message)
    } catch (e) {
      if (!this.closed) {
        failure = (e as Error).message || 'Claude stopped unexpectedly'
        const tail = this.stderrTail.trim().split(/\r?\n/).slice(-6).join('\n')
        this.emit({ type: 'items', items: [{ kind: 'note', id: randomUUID(), tone: 'error', text: failure, detail: tail || undefined }] })
      }
    } finally {
      if (this.q === q) {
        this.q = null
        this.queue = null
        this.abort = null
      }
      this.rejectPending('The chat stopped.')
      this.clearPartial()
      if (!this.closed) this.setStatus(failure ? 'error' : 'stopped', failure)
    }
  }

  private handle(m: SDKMessage): void {
    switch (m.type) {
      case 'system':
        this.handleSystem(m as Extract<SDKMessage, { type: 'system' }>)
        return
      case 'stream_event': {
        if (m.parent_tool_use_id) return
        const ev = m.event as { type: string; content_block?: { type: string }; delta?: { type: string; text?: string } }
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') this.partial = ''
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          this.partial += ev.delta.text ?? ''
          this.schedulePartial()
        }
        return
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return
        this.clearPartial()
        const items = assistantItems(m.message.content, m.uuid)
        const now = Date.now()
        for (const it of items) {
          if (it.kind === 'thinking') it.ms = now - this.mark
          if (it.kind === 'tool') {
            it.startedAt = now
            this.toolStarts.set(it.id, now)
          }
        }
        if (items.length) this.mark = now
        if (items.length) this.emit({ type: 'items', items })
        if (m.error && m.error !== 'max_output_tokens') {
          this.emit({ type: 'items', items: [{ kind: 'note', id: randomUUID(), tone: 'error', text: errorText(m.error) }] })
        }
        return
      }
      case 'user': {
        if (m.parent_tool_use_id || ('isReplay' in m && m.isReplay)) return
        const synthetic = m.isSynthetic === true || (!!m.origin && (m.origin as { kind?: string }).kind !== 'human')
        const { item, results } = parseUserContent(m.message.content, m.uuid ?? randomUUID(), undefined, true)
        const now = Date.now()
        for (const r of results) {
          const start = this.toolStarts.get(r.toolUseId)
          this.toolStarts.delete(r.toolUseId)
          this.emit({ type: 'tool-result', ...r, ms: start ? now - start : undefined })
        }
        if (results.length) this.mark = now
        if (item && synthetic) {
          fillThumbnails([item])
          this.emit({ type: 'items', items: [item] })
        }
        return
      }
      case 'result': {
        this.clearPartial()
        const error = m.subtype === 'success' ? (m.is_error ? m.result : undefined) : m.errors?.join('\n') || 'The turn ended with an error.'
        if (error) this.emit({ type: 'items', items: [{ kind: 'note', id: randomUUID(), tone: 'error', text: truncate(error, 2000) }] })
        this.emit({ type: 'turn-done', costUsd: m.total_cost_usd, durationMs: m.duration_ms, error })
        void this.refreshContext()
        this.setStatus('idle')
        this.onTurnDone(this.tabId, error)
        return
      }
      default:
        return
    }
  }

  private handleSystem(m: Extract<SDKMessage, { type: 'system' }>): void {
    const sub = (m as { subtype: string }).subtype
    if (sub === 'init') {
      const init = m as { session_id: string; model?: string; permissionMode?: PermissionMode }
      this.sessionId = init.session_id
      this.emit({ type: 'session', sessionId: init.session_id, model: init.model, permissionMode: init.permissionMode })
      void this.loadCapabilities()
    } else if (sub === 'compact_boundary') {
      this.emit({ type: 'items', items: [{ kind: 'note', id: m.uuid, tone: 'info', text: 'Conversation compacted' }] })
      void this.refreshContext()
    } else if (sub === 'commands_changed') {
      const list = (m as { commands?: SlashCommand[] }).commands ?? []
      this.emit({ type: 'commands', commands: list.map(toCommandInfo) })
    } else if (sub === 'local_command_output' || sub === 'informational') {
      const content = (m as { content?: string }).content ?? ''
      if (content.trim()) {
        this.emit({ type: 'items', items: [{ kind: 'note', id: m.uuid, tone: 'info', text: content.split('\n')[0].slice(0, 240), detail: content.includes('\n') ? truncate(content, 8000) : undefined }] })
      }
    } else if (sub === 'api_retry') {
      const r = m as { attempt: number; max_retries: number; error: string }
      this.emit({ type: 'items', items: [{ kind: 'note', id: m.uuid, tone: 'info', text: `${errorText(r.error)} Retrying (${r.attempt} of ${r.max_retries}).` }] })
    }
  }

  private async loadCapabilities(): Promise<void> {
    const q = this.q
    if (!q) return
    try {
      const [models, commands] = await Promise.all([q.supportedModels(), q.supportedCommands()])
      this.emit({ type: 'models', models: modelOptions(models) })
      this.emit({ type: 'commands', commands: commands.map(toCommandInfo) })
    } catch {
      // older CLIs may not answer; the UI keeps its defaults
    }
    void this.refreshContext()
  }

  /** How full the context window is, the way /context counts it. Answers from the last response, no extra calls. */
  private async refreshContext(): Promise<void> {
    const q = this.q
    if (!q) return
    try {
      const c = await q.getContextUsage({ detail: 'summary' })
      const sum = (kind: string): number => c.categories.filter((x) => x.kind === kind).reduce((a, x) => a + x.tokens, 0)
      const context: ContextInfo = { used: c.totalTokens, max: c.maxTokens, buffer: sum('buffer') }
      learnedWindow = { max: context.max, buffer: context.buffer }
      this.emit({ type: 'context', context })
    } catch {
      // an older CLI: no meter
    }
  }

  private schedulePartial(): void {
    if (this.partialTimer) return
    this.partialTimer = setTimeout(() => {
      this.partialTimer = null
      if (this.partial) this.emit({ type: 'partial', text: this.partial })
    }, 40)
  }

  private clearPartial(): void {
    if (this.partialTimer) clearTimeout(this.partialTimer)
    this.partialTimer = null
    if (this.partial) this.emit({ type: 'partial-clear' })
    this.partial = ''
  }

  private canUseTool: CanUseTool = (toolName, input, { signal, suggestions, decisionReason, blockedPath }) => {
    const requestId = randomUUID()
    let request: PermissionRequest
    if (toolName === 'AskUserQuestion') {
      const qs = Array.isArray(input.questions) ? (input.questions as Question[]) : []
      request = {
        requestId,
        kind: 'question',
        toolName,
        summary: 'Claude has a question',
        canAlwaysAllow: false,
        questions: qs.map((q) => ({
          question: q.question,
          header: q.header,
          multiSelect: q.multiSelect,
          options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description }))
        }))
      }
    } else if (toolName === 'ExitPlanMode') {
      request = {
        requestId,
        kind: 'plan',
        toolName,
        summary: 'Claude finished planning',
        canAlwaysAllow: false,
        plan: typeof input.plan === 'string' ? input.plan : ''
      }
    } else {
      const view = describeTool(toolName, input)
      request = {
        requestId,
        kind: 'tool',
        toolName,
        summary: view.summary,
        detail: view.detail,
        diff: view.diff,
        reason: decisionReason ?? (blockedPath ? `This reaches outside the project: ${blockedPath}` : undefined),
        canAlwaysAllow: !!suggestions?.length
      }
    }
    this.emit({ type: 'permission', request })

    return new Promise<PermissionResult>((resolve) => {
      const finish = (result: PermissionResult): void => {
        if (!this.pending.has(requestId)) return
        this.pending.delete(requestId)
        this.emit({ type: 'permission-done', requestId })
        resolve(result)
      }
      this.pending.set(requestId, (r) => finish(this.toResult(r, input, suggestions)))
      signal.addEventListener('abort', () => finish({ behavior: 'deny', message: 'Cancelled.' }), { once: true })
    })
  }

  private toResult(r: PermissionResponse, input: Record<string, unknown>, suggestions?: PermissionUpdate[]): PermissionResult {
    switch (r.decision) {
      case 'allow':
        return { behavior: 'allow', updatedInput: input }
      case 'allow-always':
        return { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions }
      case 'answer':
        return { behavior: 'allow', updatedInput: { ...input, answers: r.answers } }
      case 'approve-plan':
        this.opts.permissionMode = r.mode
        this.emit({ type: 'mode', permissionMode: r.mode })
        return { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: r.mode, destination: 'session' }] }
      case 'reject-plan':
        return { behavior: 'deny', message: r.message?.trim() || 'The user wants to keep planning. Ask what to change.' }
      case 'deny':
      default:
        return { behavior: 'deny', message: ('message' in r && r.message?.trim()) || 'The user declined this action.' }
    }
  }

  private rejectPending(message: string): void {
    for (const [id, respond] of [...this.pending]) {
      respond({ decision: 'deny', message })
      this.pending.delete(id)
    }
  }

  respond(requestId: string, response: PermissionResponse): void {
    this.pending.get(requestId)?.(response)
  }

  async send(text: string, images: ImageAttachment[]): Promise<void> {
    if (!this.q) {
      this.setStatus('starting')
      await this.start()
    }
    const content = [
      ...images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType as 'image/png', data: img.data }
      })),
      ...(text ? [{ type: 'text' as const, text }] : [])
    ]
    this.mark = Date.now()
    this.queue!.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
    this.setStatus('running')
  }

  async interrupt(): Promise<void> {
    this.rejectPending('Stopped by the user.')
    try {
      await this.q?.interrupt()
    } catch {
      // nothing running
    }
  }

  async setModel(model: string | null): Promise<void> {
    this.opts.model = model
    try {
      await this.q?.setModel(model || undefined)
    } catch {
      // applied on next start
    }
  }

  async setEffort(effort: EffortLevel | null, ultracode: boolean): Promise<void> {
    this.opts.effort = effort
    this.opts.ultracode = ultracode
    if (!this.q) return
    try {
      // Send both keys: a new effort level alone would also switch ultracode off.
      await this.q.applyFlagSettings({ effortLevel: effort ?? defaultEffort() ?? null, ultracode })
    } catch {
      // applied on next start
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.opts.permissionMode = mode
    try {
      await this.q?.setPermissionMode(mode)
    } catch {
      // applied on next start
    }
    this.emit({ type: 'mode', permissionMode: mode })
  }

  close(): void {
    this.closed = true
    this.rejectPending('The chat was closed.')
    this.abort?.abort()
    this.queue?.close()
    try {
      this.q?.close()
    } catch {
      // already closed
    }
    this.q = null
  }
}

function errorText(code: string): string {
  switch (code) {
    case 'authentication_failed':
      return 'Claude is not signed in. Run `claude` in a terminal and sign in.'
    case 'rate_limit':
      return 'Usage limit reached.'
    case 'overloaded':
      return 'Claude is overloaded right now.'
    case 'billing_error':
      return 'There is a billing problem with this Claude account.'
    case 'model_not_found':
      return 'That model is not available on this account.'
    case 'server_error':
      return 'Claude had a server error.'
    default:
      return 'Claude ran into a problem.'
  }
}

// ---------- Registry ----------

const chats = new Map<string, ChatSession>()

export function openChat(
  web: WebContents,
  tabId: string,
  opts: ChatStartOptions,
  settings: () => LoomSettings,
  onTurnDone: (tabId: string, error?: string) => void
): void {
  const existing = chats.get(tabId)
  if (existing) {
    existing.rebind(web)
    return
  }
  chats.set(tabId, new ChatSession(web, tabId, opts, settings, onTurnDone))
}

/** Starts holding a chat's events while its tab moves to another window. */
export function holdChat(tabId: string): void {
  chats.get(tabId)?.hold()
}

/** Sends a chat's events to another window, when its tab moves there. */
export function rebindChat(tabId: string, web: WebContents): void {
  chats.get(tabId)?.rebind(web)
}

export function getChat(tabId: string): ChatSession | undefined {
  return chats.get(tabId)
}

export function closeChat(tabId: string): void {
  chats.get(tabId)?.close()
  chats.delete(tabId)
}

export function closeAllChats(): void {
  for (const id of [...chats.keys()]) closeChat(id)
}

export function liveQuery(): Query | null {
  for (const c of chats.values()) if (c.query) return c.query
  return null
}

export function runningChats(): number {
  return [...chats.values()].filter((c) => c.running).length
}

/**
 * A commit message for what changed, written by Claude with your CLAUDE.md loaded, so your commit
 * rules apply. One answer, no tools, nothing saved to your chat history.
 */
export async function writeCommitMessage(cwd: string, files: string, diff: string, settings: LoomSettings): Promise<{ message?: string; error?: string }> {
  const sdk = await loadSdk()
  const prompt = [
    'Write the git commit message for the changes below. Follow the commit message rules in your instructions (CLAUDE.md) if there are any.',
    'Reply with the commit message and nothing else: no explanation, no code fences. Do not use any tools.',
    '',
    'Changed files:',
    files || '(none listed)',
    '',
    'Diff:',
    diff || '(no textual diff, for example only new or binary files)'
  ].join('\n')
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 90_000)
  try {
    let text = ''
    for await (const m of sdk.query({
      prompt,
      options: {
        cwd,
        model: 'sonnet',
        maxTurns: 1,
        persistSession: false,
        abortController: abort,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        pathToClaudeCodeExecutable: executableFor(settings),
        canUseTool: async () => ({ behavior: 'deny', message: 'Write the message only.' })
      }
    })) {
      if (m.type === 'result' && m.subtype === 'success') text = m.result
    }
    const message = text.trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
    return message ? { message } : { error: 'Claude did not write a message. Try again.' }
  } catch (e) {
    return { error: abort.signal.aborted ? 'Claude took too long. Try again.' : (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/** Claude Code's folder for a project's chats: the path with everything but letters and digits as "-". */
function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Moves a chat to another project. Its history file and the folder beside it (sub-agent work) go
 * to the new project's folder, so Claude Code resumes it there, and the messages recorded at the
 * old root say the new one, so every app lists it under the new project. Messages recorded in
 * other folders keep their paths. The original file is kept in ~/.claude/chat-backups.
 */
export async function moveSession(sessionId: string, fromCwd: string, toCwd: string): Promise<{ ok: boolean; error?: string }> {
  const dirName = projectDirName(toCwd)
  if (dirName.length > 200) return { ok: false, error: "That project's path is too long for Claude Code's chat folders." }
  const src = (await transcriptIndex()).get(sessionId)
  if (!src) return { ok: false, error: "This chat's history file was not found." }
  const root = join(homedir(), '.claude', 'projects')
  const destDir = join(root, dirName)
  const sameFolder = dirname(src).toLowerCase() === destDir.toLowerCase()
  const dest = join(destDir, `${sessionId}.jsonl`)
  if (!sameFolder && existsSync(dest)) return { ok: false, error: 'That project already has a chat with this id.' }

  // Written next to the destination first, so a failure halfway leaves the original untouched.
  const part = `${dest}.moving`
  const pattern = new RegExp(`"cwd":"${escapeRegExp(JSON.stringify(fromCwd).slice(1, -1))}"`, 'gi')
  const replacement = `"cwd":${JSON.stringify(toCwd)}`
  try {
    await fsp.mkdir(destDir, { recursive: true })
    const out = createWriteStream(part, { encoding: 'utf8' })
    const lines = createInterface({ input: createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!out.write(`${line.replace(pattern, replacement)}\n`)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  } catch (e) {
    await fsp.rm(part, { force: true })
    return { ok: false, error: `The chat could not be copied: ${(e as Error).message}` }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backups = join(homedir(), '.claude', 'chat-backups')
  await fsp.mkdir(backups, { recursive: true })
  const side = join(dirname(src), sessionId)
  try {
    // A copy of the original first; then the moved chat goes in place; only then does the original go.
    // A failure at any point leaves the chat whole in at least one place.
    await fsp.copyFile(src, join(backups, `${sessionId}-moved-${stamp}.jsonl`))
    if (!sameFolder && existsSync(side)) await fsp.cp(side, join(destDir, sessionId), { recursive: true })
    await fsp.rename(part, dest)
    if (!sameFolder) {
      await fsp.rm(src, { force: true })
      if (existsSync(side)) await fsp.rename(side, join(backups, `${sessionId}-moved-${stamp}`))
    }
  } catch (e) {
    await fsp.rm(part, { force: true })
    return { ok: false, error: `The chat could not be moved: ${(e as Error).message}` }
  }
  sessionCache = null
  cwdCache.delete(sessionId)
  return { ok: true }
}
