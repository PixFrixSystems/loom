import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  ChatEvent,
  ChatItem,
  ChatStartOptions,
  ChatStatus,
  EffortLevel,
  HistoryResult,
  ImageAttachment,
  ImagePreview,
  ModelOption,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  SessionSummary,
  SlashCommandInfo
} from '@shared/types'
import { truncate } from './convert'
import { ExternalProtocol, ExternalProtocolError } from './externalProtocol'
import { fillThumbnails, keepImage } from './images'

type Fields = Record<string, unknown>
type WireId = string | number
type ExternalItem = Fields & { type: string; id: string }
type ExternalTurn = {
  id: string
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
  items?: ExternalItem[]
  error?: { message: string; additionalDetails?: string | null } | null
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
}
type ExternalThread = {
  id: string
  cwd: string
  preview: string
  name?: string | null
  model?: string | null
  createdAt: number
  updatedAt: number
  gitInfo?: { branch?: string | null } | null
  turns?: ExternalTurn[]
}
type ExternalModel = {
  model: string
  displayName: string
  description?: string
  isDefault?: boolean
  supportedReasoningEfforts?: { reasoningEffort: string }[]
}
type ExternalSkill = {
  name: string
  path: string
  description: string
  shortDescription?: string
  interface?: { shortDescription?: string }
  scope: 'user' | 'repo' | 'system' | 'admin'
  pluginId?: string | null
  enabled: boolean
}
type CollaborationPreset = { mode: 'plan' | 'default' | null; reasoning_effort?: string | null }
type ThreadConnection = {
  thread: ExternalThread
  model?: string
  reasoningEffort?: string | null
  collaborationMode?: { mode?: string; settings?: { reasoning_effort?: string | null } } | null
}
type Page<T> = { data: T[]; nextCursor?: string | null }
type SessionsCache = {
  program: string
  loadedAt?: number
  pending: Promise<SessionSummary[]>
  cancel: () => void
}
type PendingMessage = { text: string; images: ImageAttachment[]; id?: string }
type RunningTurn = {
  message: PendingMessage
  startedAt: number
  mode?: PermissionMode
  submitted: boolean
  turnId?: string
  interruptRequested: boolean
  interruptSent: boolean
}
type PendingRequest = {
  request: PermissionRequest
  finish: (response?: PermissionResponse) => void
}

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const IDLE_RELEASE_MS = Number(process.env.LOOM_IDLE_RELEASE_MS) || 30 * 60_000
const HISTORY_LIMIT = 1500
const SESSION_LIST_TIMEOUT_MS = 8000
const TOOL_TEXT_LIMIT = 8000
const APPROVAL_TEXT_LIMIT = 32_000
const SKILL_CACHE_MS = 30_000

const str = (value: unknown): string => typeof value === 'string' ? value : ''
const fields = (value: unknown): Fields => value && typeof value === 'object' ? value as Fields : {}
const rows = (value: unknown): Fields[] => Array.isArray(value) ? value.map(fields) : []
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

function iso(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function pretty(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return truncate(typeof value === 'string' ? value : JSON.stringify(value, null, 2), TOOL_TEXT_LIMIT)
}

function methodUnavailable(error: unknown, method: string): boolean {
  if (!(error instanceof ExternalProtocolError)) return false
  return error.code === -32601 || (error.code === -32600 && error.message.includes(method) && /unknown|unrecognized|unsupported|not found/i.test(error.message))
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((line) => line.trim()) ?? '').slice(0, 160)
}

function patchView(changes: unknown): { summary: string; detail?: string; filePath?: string } {
  const files = rows(changes)
  const paths = files.map((change) => str(change.path)).filter(Boolean)
  const detail = files.map((change) => {
    const kind = fields(change.kind)
    const action = str(kind.type)
    const moveTo = str(kind.move_path)
    const path = str(change.path)
    const label = moveTo ? 'Move ' + path + ' to ' + moveTo : [action, path].filter(Boolean).join(' ')
    return [label, str(change.diff)].filter(Boolean).join('\n')
  }).join('\n\n')
  return {
    summary: paths.length > 1 ? paths.length + ' files' : paths[0] || 'Proposed file changes',
    detail: detail || undefined,
    filePath: paths.length === 1 && isAbsolute(paths[0]) ? paths[0] : undefined
  }
}

function imagePreview(input: Fields): ImagePreview | undefined {
  const match = str(input.url).match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\r\n]+)$/i)
  return match ? { thumb: null, ref: keepImage(match[1], match[2]) } : undefined
}

function itemFor(item: ExternalItem, phase: 'live' | 'completed' | 'history', fallbackTime?: number): ChatItem | undefined {
  const startedAt = number(item.startedAtMs) ?? fallbackTime
  const completedAt = number(item.completedAtMs)
  const ts = iso(startedAt ?? completedAt)
  const id = item.id
  const ms = number(item.durationMs) ?? (startedAt !== undefined && completedAt !== undefined ? Math.max(0, completedAt - startedAt) : undefined)
  if (!id) return undefined

  if (item.type === 'userMessage') {
    if (phase !== 'history') return undefined // Loom already displays the user input optimistically.
    const content = rows(item.content)
    const text = content.filter((input) => input.type === 'text').map((input) => str(input.text)).join('\n')
    const images = content.filter((input) => input.type === 'image' || input.type === 'localImage')
    const previews = images.flatMap((input) => imagePreview(input) ?? [])
    return { kind: 'user', id: str(item.clientId) || id, text, images: images.length, previews, ts }
  }
  if (item.type === 'agentMessage' || item.type === 'plan') {
    const text = str(item.text)
    return phase !== 'live' && text ? { kind: 'assistant', id, text, ts } : undefined
  }
  if (item.type === 'reasoning') {
    return phase === 'live' ? undefined : { kind: 'thinking', id, text: strings(item.summary).join('\n\n'), ms, ts }
  }
  if (item.type === 'contextCompaction') {
    return phase === 'live' ? undefined : { kind: 'note', id, text: 'The agent summarized earlier messages.', tone: 'summary', ts }
  }

  const isError = item.status === 'failed' || item.status === 'declined' || item.status === 'interrupted' || item.success === false
  const status: Extract<ChatItem, { kind: 'tool' }>['status'] = phase === 'live' ? 'running' : isError ? 'error' : 'done'
  const tool = { kind: 'tool' as const, id, ts, status, isError, startedAt, ms }
  switch (item.type) {
    case 'commandExecution': {
      const command = str(item.command)
      return {
        ...tool,
        name: process.platform === 'win32' ? 'PowerShell' : 'Bash',
        summary: firstLine(command) || 'Run command',
        detail: pretty(command),
        result: pretty(item.aggregatedOutput ?? (isError && item.exitCode != null ? 'Exit code ' + item.exitCode : undefined))
      }
    }
    case 'fileChange': {
      const patch = patchView(item.changes)
      return { ...tool, ...patch, name: 'Edit', detail: pretty(patch.detail), result: isError ? 'The file change ' + item.status + '.' : undefined }
    }
    case 'mcpToolCall':
    case 'dynamicToolCall': {
      const name = str(item.tool) || 'Tool'
      const server = str(item.server) || str(item.namespace)
      return { ...tool, name, summary: server, detail: pretty(item.arguments), result: pretty(item.error ?? item.result ?? item.contentItems) }
    }
    case 'collabAgentToolCall':
      return { ...tool, name: 'Agent', summary: str(item.tool), detail: pretty(item.prompt), result: pretty(item.agentsStates) }
    case 'webSearch':
      return { ...tool, name: 'WebSearch', summary: str(item.query) || str(fields(item.action).url) || 'Search the web' }
    case 'imageView':
      return { ...tool, name: 'View image', summary: str(item.path) }
    default:
      return undefined
  }
}

async function withProtocol<T>(program: string, run: (protocol: ExternalProtocol) => Promise<T>, cwd?: string): Promise<T> {
  const protocol = new ExternalProtocol(program, { cwd })
  try {
    return await run(protocol)
  } finally {
    protocol.close()
  }
}

let sessionsCache: SessionsCache | undefined

export function clearExternalSessions(): void {
  sessionsCache?.cancel()
  sessionsCache = undefined
}

async function collectSessions(protocol: ExternalProtocol): Promise<SessionSummary[]> {
  const sessions = new Map<string, SessionSummary>()
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page: Page<ExternalThread> = await protocol.request('thread/list', {
      cursor, limit: 100, sortKey: 'updated_at', currentAccountOnly: true
    })
    for (const thread of page.data) {
      if (!thread.cwd || !thread.id) continue
      sessions.set(thread.id, {
        sessionId: thread.id,
        title: (thread.name || thread.preview || 'Untitled chat').replace(/\s+/g, ' ').trim(),
        cwd: thread.cwd,
        lastModified: thread.updatedAt * 1000,
        createdAt: thread.createdAt * 1000,
        gitBranch: thread.gitInfo?.branch ?? undefined
      })
    }
    cursor = page.nextCursor ?? undefined
    if (cursor && seen.has(cursor)) throw new Error('The external agent repeated a history page.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return [...sessions.values()]
}

export async function listExternalSessions(program: string, force = false): Promise<SessionSummary[]> {
  if (sessionsCache?.program === program) {
    if (sessionsCache.loadedAt === undefined || (!force && Date.now() - sessionsCache.loadedAt < 4000)) return sessionsCache.pending
  } else {
    clearExternalSessions()
  }
  const protocol = new ExternalProtocol(program)
  const timer = setTimeout(() => protocol.close(), SESSION_LIST_TIMEOUT_MS)
  timer.unref()
  const pending = collectSessions(protocol).finally(() => {
    clearTimeout(timer)
    protocol.close()
  })
  const entry: SessionsCache = { program, pending, cancel: () => protocol.close() }
  sessionsCache = entry
  try {
    const sessions = await pending
    entry.loadedAt = Date.now()
    return sessions
  } catch (error) {
    if (sessionsCache === entry) sessionsCache = undefined
    throw error
  }
}

export function listExternalModels(program: string): Promise<ModelOption[]> {
  return withProtocol(program, async (protocol) => {
    const models: ModelOption[] = []
    let cursor: string | undefined
    do {
      const page: Page<ExternalModel> = await protocol.request('model/list', { cursor, limit: 100 })
      for (const model of page.data) {
        const supported = model.supportedReasoningEfforts?.map((option) => option.reasoningEffort)
        models.push({
          value: model.model,
          label: model.displayName || model.model,
          description: model.description,
          efforts: supported && EFFORTS.filter((effort) => supported.includes(effort))
        })
      }
      if (page.nextCursor === cursor) break
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return models
  })
}

const skillCache = new Map<string, { at: number; list: Promise<ExternalSkill[]> }>()

function skillsFor(program: string, cwd: string, protocol?: ExternalProtocol): Promise<ExternalSkill[]> {
  const now = Date.now()
  const key = JSON.stringify([program, cwd])
  const cached = skillCache.get(key)
  if (cached && now - cached.at < SKILL_CACHE_MS) return cached.list
  for (const [entry, value] of skillCache) {
    if (now - value.at >= SKILL_CACHE_MS) skillCache.delete(entry)
  }
  const read = async (connection: ExternalProtocol): Promise<ExternalSkill[]> => {
    const { data } = await connection.request<{ data: { skills: ExternalSkill[] }[] }>('skills/list', { cwds: [cwd] })
    return data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled && skill.name && isAbsolute(skill.path))
  }
  const list = protocol ? read(protocol) : withProtocol(program, read, cwd)
  skillCache.set(key, { at: now, list })
  void list.catch(() => {
    if (skillCache.get(key)?.list === list) skillCache.delete(key)
  })
  return list
}

export async function listExternalSkills(program: string, cwd: string): Promise<SlashCommandInfo[]> {
  const skills = await skillsFor(program, cwd)
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.interface?.shortDescription || skill.shortDescription || skill.description,
    source: skill.pluginId || (skill.scope === 'repo' ? 'project' : skill.scope)
  }))
}

async function skillInputs(program: string, cwd: string, protocol: ExternalProtocol, text: string): Promise<Fields[]> {
  const names = new Set([...text.matchAll(/(?<![\p{L}\p{N}_\\$])\$([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]))
  if (!names.size) return []
  const skills = await skillsFor(program, cwd, protocol).catch(() => [])
  return [...names].flatMap((name) => {
    const matches = skills.filter((skill) => skill.name === name)
    return matches.length === 1 ? [{ type: 'skill', name, path: matches[0].path }] : []
  })
}

function turnItems(turn: ExternalTurn): ChatItem[] {
  const start = turn.startedAt == null ? undefined : turn.startedAt * 1000
  const end = turn.completedAt == null ? undefined : turn.completedAt * 1000
  const items = (turn.items ?? []).flatMap((item) => itemFor(item, 'history', start) ?? [])
  const duration = turn.durationMs ?? (start !== undefined && end !== undefined ? end - start : undefined)
  if (duration && duration >= 1000) items.push({ kind: 'done', id: turn.id + ':done', ms: duration, ts: iso(end) })
  if (turn.status === 'failed' && turn.error?.message) {
    items.push({ kind: 'note', id: turn.id + ':error', text: turn.error.message, detail: turn.error.additionalDetails ?? undefined, tone: 'error', ts: iso(end) })
  }
  return items
}

async function historyTurns(protocol: ExternalProtocol, sessionId: string): Promise<HistoryResult> {
  let cursor: string | undefined
  let total = 0
  let shown: ChatItem[] = []
  do {
    const page: Page<ExternalTurn> = await protocol.request('thread/turns/list', {
      threadId: sessionId, itemsView: 'full', sortDirection: 'desc', limit: 16, cursor
    })
    for (const turn of page.data) {
      const items = turnItems(turn)
      total += items.length
      if (shown.length < HISTORY_LIMIT) shown = [...items.slice(-(HISTORY_LIMIT - shown.length)), ...shown]
    }
    if (page.nextCursor === cursor) break
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return { items: shown, total }
}

export async function readExternalHistory(program: string, sessionId: string): Promise<HistoryResult> {
  try {
    return await withProtocol(program, async (protocol) => {
      let history: HistoryResult
      try {
        history = await historyTurns(protocol, sessionId)
      } catch (error) {
        if (!methodUnavailable(error, 'thread/turns/list')) throw error
        const { thread } = await protocol.request<{ thread: ExternalThread }>('thread/read', { threadId: sessionId, includeTurns: true })
        const items = (thread.turns ?? []).flatMap(turnItems)
        history = { items: items.slice(-HISTORY_LIMIT), total: items.length }
      }
      fillThumbnails(history.items)
      return history
    })
  } catch (error) {
    return { items: [], total: 0, error: (error as Error).message }
  }
}

export async function renameExternalSession(program: string, sessionId: string, title: string): Promise<void> {
  await withProtocol(program, (protocol) => protocol.request('thread/name/set', { threadId: sessionId, name: title }))
  if (sessionsCache?.program === program) clearExternalSessions()
}

function modeFor(mode: PermissionMode | null): PermissionMode {
  return mode === 'acceptEdits' || mode === 'plan' ? mode : 'default'
}

function sandboxFor(mode: PermissionMode, cwd: string): Fields {
  if (mode === 'acceptEdits') {
    return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
  }
  return { type: 'readOnly', networkAccess: false }
}

function reviewDecision(response?: PermissionResponse): 'accept' | 'decline' | 'cancel' {
  if (!response) return 'cancel'
  return response.decision === 'allow' ? 'accept' : 'decline'
}

export class ExternalChatSession {
  sessionId: string | null
  private protocol: ExternalProtocol | null = null
  private connectedProgram?: string
  private threadId: string | null = null
  private status: ChatStatus = 'idle'
  private error?: string
  private active: RunningTurn | null = null
  private queue: PendingMessage[] = []
  private held: ChatEvent[] | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private partialTimer: NodeJS.Timeout | null = null
  private closed = false
  private releaseWhenIdle = false
  private partial = ''
  private thinking: string | undefined
  private readonly approvals = new Map<WireId, PendingRequest>()
  private readonly tools = new Map<string, ExternalItem>()
  private threadModel?: string
  private selectedModel: string | null = null
  private selectedEffort: EffortLevel | null = null
  private planActive = false
  private collaborationPresets: CollaborationPreset[] | undefined
  private defaultReasoningEffort?: string | null

  constructor(
    private web: WebContents,
    readonly tabId: string,
    private readonly opts: ChatStartOptions,
    private readonly program: () => string,
    private readonly onTurnDone: (tabId: string, error?: string, ask?: string) => void
  ) {
    this.sessionId = opts.sessionId
  }

  get running(): boolean {
    return this.active !== null
  }

  hold(): void {
    this.held ??= []
  }

  rebind(web: WebContents): void {
    this.web = web
    const held = this.held
    this.held = null
    for (const event of held ?? []) this.emit(event)
    this.emit({ type: 'status', status: this.status, error: this.error })
    if (this.partial) this.emit({ type: 'partial', text: this.partial })
    if (this.thinking !== undefined) this.emit({ type: 'thinking-partial', text: this.thinking })
    for (const pending of this.approvals.values()) this.emit({ type: 'permission', request: pending.request })
  }

  private emit(event: ChatEvent): void {
    if (this.held) this.held.push(event)
    else if (!this.web.isDestroyed()) this.web.send('chat:event', this.tabId, event)
  }

  private setStatus(status: ChatStatus, error?: string): void {
    this.status = status
    this.error = error
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = !this.running && this.protocol ? setTimeout(() => this.release(), IDLE_RELEASE_MS) : null
    this.idleTimer?.unref()
    this.emit({ type: 'status', status, error })
  }

  release(): void {
    if (this.running) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.disconnect()
  }

  releaseAfterTurn(): void {
    if (this.running) this.releaseWhenIdle = true
    else this.release()
  }

  private disconnect(): void {
    this.releaseWhenIdle = false
    this.protocol?.close()
    this.protocol = null
    this.connectedProgram = undefined
    this.threadId = null
    this.threadModel = undefined
    this.selectedModel = null
    this.selectedEffort = null
    this.planActive = false
    this.collaborationPresets = undefined
    this.defaultReasoningEffort = undefined
  }

  close(): void {
    this.closed = true
    this.active = null
    this.queue = []
    this.release()
    this.clearPartial()
    this.cancelApprovals()
  }

  async send(text: string, images: ImageAttachment[], id?: string): Promise<void> {
    if (this.closed) return
    this.queue.push({ text, images, id })
    if (!this.active) void this.startNext()
  }

  private restoreUnsent(messages: PendingMessage[]): void {
    const ids = messages.flatMap((message) => message.id ?? [])
    if (ids.length) this.emit({ type: 'unsent', ids })
  }

  private async connect(turn: RunningTurn, program: string, model: string | null): Promise<ExternalProtocol | null> {
    if (this.protocol) return this.protocol
    const cwd = this.opts.cwd
    const protocol = new ExternalProtocol(program, {
      cwd,
      experimentalApi: true,
      onNotification: (method, params) => {
        if (this.protocol === protocol) this.handleNotification(method, params)
      },
      onRequest: (method, params, id) => {
        if (this.protocol !== protocol) throw new Error('The agent connection closed.')
        return this.handleRequest(method, params, id)
      },
      onClose: (error) => {
        if (this.protocol !== protocol) return
        this.disconnect()
        if (this.active) this.fail(this.active, error.message)
      }
    })
    this.protocol = protocol
    this.connectedProgram = program

    // Ask the executable for its effective default when resuming without a model override.
    // Otherwise, a model chosen in an earlier turn could stick after selecting Program default.
    let effectiveModel = model ?? undefined
    if (this.sessionId && !effectiveModel) {
      const { config } = await protocol.request<{ config: { model?: string | null } }>('config/read', { cwd })
      effectiveModel = config.model ?? undefined
      if (!effectiveModel) {
        const { data } = await protocol.request<Page<ExternalModel>>('model/list', {})
        effectiveModel = data.find((candidate) => candidate.isDefault)?.model
      }
    }
    if (this.active !== turn) return null
    const mode = modeFor(this.opts.permissionMode)
    const options = {
      cwd,
      model: effectiveModel,
      sandbox: mode === 'acceptEdits' ? 'workspace-write' : 'read-only',
      approvalPolicy: mode === 'plan' ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      config: {
        sandbox_workspace_write: {
          writable_roots: [cwd], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true
        }
      }
    }
    const reply = this.sessionId
      ? await protocol.request<ThreadConnection>('thread/resume', {
        ...options, threadId: this.sessionId, excludeTurns: true
      })
      : await protocol.request<ThreadConnection>('thread/start', options)
    if (this.active !== turn) return null
    this.threadId = reply.thread.id
    this.threadModel = reply.model ?? reply.thread.model ?? effectiveModel
    this.selectedModel = model
    this.planActive = reply.collaborationMode?.mode === 'plan'
    if (!this.planActive) this.defaultReasoningEffort = reply.reasoningEffort
    return protocol
  }

  private async collaborationMode(protocol: ExternalProtocol, mode: PermissionMode, effort: EffortLevel | null): Promise<Fields | undefined> {
    const target = mode === 'plan' ? 'plan' : 'default'
    if (target === 'default' && !this.planActive) return undefined
    if (!this.collaborationPresets) {
      try {
        const { data } = await protocol.request<{ data: CollaborationPreset[] }>('collaborationMode/list', {})
        this.collaborationPresets = data
      } catch (error) {
        if (methodUnavailable(error, 'collaborationMode/list')) throw new Error('This external agent does not support Plan Mode. Choose another mode or update the program.')
        throw error
      }
    }
    const preset = this.collaborationPresets.find((item) => item.mode === target)
    if (!preset || !this.threadModel) throw new Error('This external agent could not configure Plan Mode. Choose another mode or update the program.')
    const defaultEffort = target === 'plan' ? preset.reasoning_effort : this.defaultReasoningEffort ?? preset.reasoning_effort
    return {
      mode: target,
      settings: { model: this.threadModel, reasoning_effort: effort ?? defaultEffort ?? null, developer_instructions: null }
    }
  }

  private async startNext(): Promise<void> {
    const message = this.queue.shift()
    if (this.closed || !message) return
    const turn: RunningTurn = { message, startedAt: Date.now(), submitted: false, interruptRequested: false, interruptSent: false }
    this.active = turn
    this.setStatus('starting')
    const program = this.program()
    const model = this.opts.model
    const effort = this.opts.effort
    try {
      if (this.connectedProgram !== program || (!model && this.selectedModel) || (!effort && this.selectedEffort)) this.disconnect()
      const protocol = await this.connect(turn, program, model)
      if (!protocol || this.active !== turn) return
      if (!this.threadId) throw new Error('The agent did not return a conversation ID.')
      const input: Fields[] = message.images.map((image) => ({ type: 'image', url: 'data:' + image.mediaType + ';base64,' + image.data }))
      if (message.text) input.unshift({ type: 'text', text: message.text, text_elements: [] })
      const mode = modeFor(this.opts.permissionMode)
      turn.mode = mode
      if (model) this.threadModel = model
      this.selectedModel = model
      this.selectedEffort = effort
      const [skills, collaborationMode] = await Promise.all([
        skillInputs(program, this.opts.cwd, protocol, message.text),
        this.collaborationMode(protocol, mode, effort)
      ])
      if (this.active !== turn) return
      this.planActive = mode === 'plan'
      turn.submitted = true
      const { turn: started } = await protocol.request<{ turn: ExternalTurn }>('turn/start', {
        threadId: this.threadId,
        cwd: this.opts.cwd,
        clientUserMessageId: message.id,
        approvalPolicy: mode === 'plan' ? 'never' : 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: sandboxFor(mode, this.opts.cwd),
        collaborationMode,
        model: model ?? undefined,
        effort: effort ?? undefined,
        input: [...input, ...skills]
      })
      if (this.active !== turn) return
      this.noteTurnStarted(turn, started.id)
      if (started.status !== 'inProgress') this.finishTurn(started)
    } catch (error) {
      if (this.active !== turn) return
      if (error instanceof ExternalProtocolError && !turn.turnId) turn.submitted = false
      this.disconnect()
      this.fail(turn, (error as Error).message)
    }
  }

  async interrupt(): Promise<void> {
    const turn = this.active
    const queued = this.queue.splice(0)
    if (!turn) return
    turn.interruptRequested = true
    this.cancelApprovals()
    if (!turn.submitted) {
      this.active = null
      this.disconnect()
      this.restoreUnsent([turn.message, ...queued])
      this.setStatus('stopped')
      return
    }
    this.restoreUnsent(queued)
    await this.interruptTurn(turn)
  }

  private async interruptTurn(turn: RunningTurn): Promise<void> {
    if (this.active !== turn || !turn.turnId || turn.interruptSent || !this.protocol) return
    turn.interruptSent = true
    try {
      await this.protocol.request('turn/interrupt', { threadId: this.threadId, turnId: turn.turnId })
    } catch (error) {
      if (this.active !== turn) return
      this.disconnect()
      this.fail(turn, (error as Error).message)
    }
  }

  setModel(model: string | null): void {
    this.opts.model = model
  }

  setEffort(effort: EffortLevel | null, _ultracode: boolean): void {
    this.opts.effort = effort
  }

  setPermissionMode(mode: PermissionMode): void {
    this.opts.permissionMode = modeFor(mode)
    this.emit({ type: 'mode', permissionMode: this.opts.permissionMode })
  }

  respond(requestId: string, response: PermissionResponse): void {
    for (const pending of this.approvals.values()) {
      if (pending.request.requestId !== requestId) continue
      pending.finish(response)
      return
    }
  }

  private cancelApprovals(): void {
    for (const pending of this.approvals.values()) pending.finish()
  }

  private waitForApproval(
    id: WireId,
    request: Omit<PermissionRequest, 'requestId' | 'canAlwaysAllow'>,
    result: (response?: PermissionResponse) => unknown
  ): Promise<unknown> {
    if (this.active?.interruptRequested || this.closed || this.approvals.has(id)) return Promise.resolve(result())
    const size = (request.detail?.length ?? 0) + (request.reason?.length ?? 0)
    if (size > APPROVAL_TEXT_LIMIT) {
      this.emit({
        type: 'items',
        items: [{ kind: 'note', id: randomUUID(), tone: 'error', text: 'The approval request was too large to review in Loom.' }]
      })
      return Promise.resolve(result({ decision: 'deny' }))
    }
    const card: PermissionRequest = { ...request, requestId: randomUUID(), canAlwaysAllow: false }
    return new Promise((resolve) => {
      const finish = (response?: PermissionResponse): void => {
        this.approvals.delete(id)
        this.emit({ type: 'permission-done', requestId: card.requestId })
        resolve(result(response))
      }
      this.approvals.set(id, { request: card, finish })
      this.emit({ type: 'permission', request: card })
      this.onTurnDone(this.tabId, undefined, card.summary || 'The agent needs your approval')
    })
  }

  private handleRequest(method: string, params: Fields, id: WireId): unknown {
    if (!this.active?.submitted || (params.threadId ?? params.conversationId) !== this.threadId ||
      (this.active.turnId && typeof params.turnId === 'string' && params.turnId !== this.active.turnId)) {
      throw new Error('The request belongs to a different conversation.')
    }
    const reason = str(params.reason) || undefined
    const planning = this.active.mode === 'plan'
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'execCommandApproval': {
        if (planning) return { decision: method === 'execCommandApproval' ? 'abort' : 'cancel' }
        const kind = params.kind
        // Stdin callbacks can refer to a displayed command without including the data being written.
        if (kind != null && kind !== 'command' && kind !== 'humanCommand') return { decision: 'cancel' }
        const item = this.tools.get(str(params.itemId))
        const cmd = Array.isArray(params.command)
          ? strings(params.command).map((arg) => JSON.stringify(arg)).join(' ')
          : str(params.command) || (kind !== 'humanCommand' ? str(item?.command) : '')
        const network = fields(params.networkApprovalContext)
        const host = str(network.host)
        const scope = str(params.cwd) || str(item?.cwd)
        const summary = host ? 'Connect to ' + host : firstLine(cmd) || 'Run a command'
        if (!cmd && !host) return { decision: method === 'execCommandApproval' ? 'abort' : 'cancel' }
        const extra = params.additionalPermissions ? JSON.stringify(params.additionalPermissions, null, 2) : ''
        const detail = [cmd, scope && 'Working directory: ' + scope,
          host && 'Network destination: ' + [str(network.protocol), host].filter(Boolean).join(' '),
          extra && 'Additional permissions:\n' + extra].filter(Boolean).join('\n\n')
        return this.waitForApproval(id, {
          kind: 'tool', toolName: host ? 'Network access' : process.platform === 'win32' ? 'PowerShell' : 'Bash', summary,
          detail, reason
        }, (response) => {
          const decision = reviewDecision(response)
          if (method !== 'execCommandApproval') return { decision }
          if (decision === 'accept') return { decision: 'approved' }
          if (decision === 'cancel') return { decision: 'abort' }
          return { decision: { denied: { rejection: 'The user declined the command.' } } }
        })
      }
      case 'item/fileChange/requestApproval':
      case 'applyPatchApproval': {
        if (planning) return { decision: method === 'applyPatchApproval' ? 'abort' : 'cancel' }
        const item = this.tools.get(str(params.itemId))
        const patch = item ? patchView(item.changes) : {
          summary: 'Proposed file changes',
          detail: params.fileChanges ? JSON.stringify(params.fileChanges, null, 2) : undefined
        }
        const grantRoot = str(params.grantRoot)
        if (!patch.detail) return { decision: method === 'applyPatchApproval' ? 'abort' : 'cancel' }
        return this.waitForApproval(id, {
          kind: 'tool', toolName: 'Edit', summary: patch.summary,
          detail: [patch.detail, grantRoot && 'Requested write access: ' + grantRoot].filter(Boolean).join('\n\n'),
          reason
        }, (response) => {
          const decision = reviewDecision(response)
          if (method !== 'applyPatchApproval') return { decision }
          if (decision === 'accept') return { decision: 'approved' }
          if (decision === 'cancel') return { decision: 'abort' }
          return { decision: { denied: { rejection: 'The user declined the file changes.' } } }
        })
      }
      case 'item/permissions/requestApproval': {
        if (planning) return { permissions: {}, scope: 'turn' }
        const permissions = fields(params.permissions)
        const profile = Object.fromEntries(Object.entries(permissions).filter(([key, value]) => (key === 'network' || key === 'fileSystem') && value != null))
        if (!Object.keys(profile).length) return { permissions: {}, scope: 'turn' }
        return this.waitForApproval(id, {
          kind: 'tool', toolName: 'Additional permissions', summary: 'Grant access for this turn',
          detail: JSON.stringify(profile, null, 2), reason
        }, (response) => ({ permissions: response?.decision === 'allow' ? profile : {}, scope: 'turn' }))
      }
      case 'item/tool/requestUserInput': {
        const questions = rows(params.questions)
          .filter((question) => str(question.id) && str(question.question) && question.isSecret !== true)
          .map((question) => ({
            id: str(question.id),
            question: str(question.question),
            header: str(question.header) || undefined,
            options: rows(question.options).flatMap((option) => str(option.label) ? [{
              label: str(option.label), description: str(option.description) || undefined
            }] : [])
          }))
        if (!questions.length) return { answers: {} }
        return this.waitForApproval(id, {
          kind: 'question', toolName: 'AskUserQuestion', summary: 'The agent has a question', questions
        }, (response) => ({
          answers: response?.decision === 'answer'
            ? Object.fromEntries(questions.flatMap(({ id: questionId, question }) => {
              const answer = response.answers[question]
              return answer?.trim() ? [[questionId, { answers: [answer] }]] : []
            }))
            : {}
        }))
      }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      default:
        throw new Error('This request is not supported by Loom.')
    }
  }

  private noteTurnStarted(turn: RunningTurn, id: string): void {
    if (!id || turn.turnId) return
    turn.turnId = id
    if (this.threadId) {
      this.sessionId = this.threadId
      this.emit({ type: 'session', sessionId: this.threadId, model: this.threadModel, permissionMode: turn.mode })
    }
    this.setStatus('running')
    if (turn.interruptRequested) void this.interruptTurn(turn)
  }

  private handleNotification(method: string, params: Fields): void {
    if (params.threadId !== this.threadId) return
    const turn = this.active
    if (!turn?.submitted || (turn.turnId && typeof params.turnId === 'string' && params.turnId !== turn.turnId)) return
    switch (method) {
      case 'turn/started':
        this.noteTurnStarted(turn, str(fields(params.turn).id))
        break
      case 'turn/completed': {
        const completed = params.turn as ExternalTurn | undefined
        if (completed && (!turn.turnId || completed.id === turn.turnId)) {
          this.noteTurnStarted(turn, completed.id)
          this.finishTurn(completed)
        }
        break
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
        this.partial += str(params.delta)
        this.schedulePartial()
        break
      case 'item/reasoning/summaryPartAdded':
        if (this.thinking) this.thinking += '\n\n'
        break
      case 'item/reasoning/summaryTextDelta':
        this.thinking = (this.thinking ?? '') + str(params.delta)
        this.schedulePartial()
        break
      case 'item/started':
      case 'item/completed': {
        const item = params.item as ExternalItem | undefined
        if (!item?.id) break
        const started = method === 'item/started'
        if (item.type === 'reasoning' && started) {
          this.thinking = ''
          this.schedulePartial()
        }
        if (item.type === 'contextCompaction') this.emit({ type: 'activity', activity: started ? 'compacting' : null })
        if (!started && (item.type === 'agentMessage' || item.type === 'plan' || item.type === 'reasoning')) this.clearPartial()
        const view = itemFor(item, started ? 'live' : 'completed', number(params.startedAtMs) ?? number(this.tools.get(item.id)?.startedAtMs))
        if (view?.kind === 'tool') {
          if (started) this.tools.set(item.id, { ...item, startedAtMs: number(item.startedAtMs) ?? number(params.startedAtMs) ?? Date.now() })
          else this.tools.delete(item.id)
        }
        if (view) this.emit({ type: 'items', items: [view] })
        break
      }
      case 'item/fileChange/patchUpdated': {
        const id = str(params.itemId)
        const started = this.tools.get(id)
        if (!started) break
        const item = { ...started, changes: params.changes }
        this.tools.set(id, item)
        const view = itemFor(item, 'live')
        if (view) this.emit({ type: 'items', items: [view] })
        break
      }
      case 'serverRequest/resolved':
        this.approvals.get(params.requestId as WireId)?.finish()
        break
      case 'thread/settings/updated':
      case 'model/rerouted': {
        const settings = fields(params.threadSettings)
        const mode = fields(settings.collaborationMode).mode
        if (mode === 'plan' || mode === 'default') this.planActive = mode === 'plan'
        const model = method === 'model/rerouted' ? str(params.toModel) : str(settings.model)
        if (!model || model === this.threadModel || !this.sessionId) break
        this.threadModel = model
        this.emit({ type: 'session', sessionId: this.sessionId, model })
        break
      }
      case 'thread/tokenUsage/updated': {
        const usage = fields(params.tokenUsage)
        const max = number(usage.modelContextWindow)
        const used = number(fields(usage.last).totalTokens)
        if (max && used !== undefined) this.emit({ type: 'context', context: { used, max, buffer: 0 } })
        break
      }
    }
  }

  private schedulePartial(): void {
    if (this.partialTimer) return
    this.partialTimer = setTimeout(() => {
      this.partialTimer = null
      if (this.partial) this.emit({ type: 'partial', text: this.partial })
      if (this.thinking !== undefined) this.emit({ type: 'thinking-partial', text: this.thinking })
    }, 40)
  }

  private clearPartial(): void {
    if (this.partialTimer) clearTimeout(this.partialTimer)
    this.partialTimer = null
    if (this.partial || this.thinking !== undefined) this.emit({ type: 'partial-clear' })
    this.partial = ''
    this.thinking = undefined
  }

  private fail(turn: RunningTurn, message: string): void {
    const unsent = turn.submitted ? this.queue.splice(0) : [turn.message, ...this.queue.splice(0)]
    this.restoreUnsent(unsent)
    this.finishTurn({ id: turn.turnId ?? '', status: 'failed', error: { message } })
  }

  private finishTurn(completed: ExternalTurn): void {
    const turn = this.active
    if (!turn) return
    this.active = null
    this.clearPartial()
    this.cancelApprovals()
    const items = (completed.items ?? []).flatMap((item) => itemFor(item, 'completed') ?? [])
    if (completed.status === 'failed' || completed.status === 'interrupted') {
      for (const item of items) this.tools.delete(item.id)
      for (const item of this.tools.values()) {
        const view = itemFor({ ...item, status: 'interrupted' }, 'completed')
        if (view?.kind === 'tool') items.push({ ...view, result: 'The tool did not finish.' })
      }
    }
    this.tools.clear()
    const error = completed.status === 'failed' ? completed.error?.message || 'The agent stopped with an error.' : undefined
    if (error) items.push({ kind: 'note', id: randomUUID(), text: error, detail: completed.error?.additionalDetails ?? undefined, tone: 'error' })
    if (items.length) this.emit({ type: 'items', items })
    this.emit({ type: 'turn-done', durationMs: completed.durationMs ?? Date.now() - turn.startedAt, error })
    if (this.releaseWhenIdle) this.release()
    this.setStatus(error ? 'error' : completed.status === 'interrupted' ? 'stopped' : 'idle', error)
    this.onTurnDone(this.tabId, error)
    if (this.queue.length) void this.startNext()
  }
}
