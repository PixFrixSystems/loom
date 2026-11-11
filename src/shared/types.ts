// Types shared by the main process, the preload bridge and the UI.

export const THREAD_COLORS = [
  'woad',
  'madder',
  'verdigris',
  'weld',
  'indigo',
  'cochineal',
  'lichen',
  'walnut',
  'slate'
] as const
export type ThreadColor = (typeof THREAD_COLORS)[number]

export interface Project {
  id: string
  name: string
  path: string
  color: ThreadColor
  groupId: string | null
  collapsed?: boolean
  /** auto: look for the site's favicon; custom: iconPath; none: show the colour thread only */
  iconMode?: 'auto' | 'custom' | 'none'
  iconPath?: string
  /** The run target the Run button starts (the last one picked). */
  runTargetId?: string
}

export interface Group {
  id: string
  name: string
  collapsed?: boolean
  /** Borrow this project's icon. Takes priority over iconPath. Neither set: no icon. */
  iconProjectId?: string
  /** An image file chosen for the group. */
  iconPath?: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto' | 'dontAsk'
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ChatTab {
  id: string
  kind: 'chat'
  projectId: string | null
  sessionId: string | null
  cwd: string
  title: string
  model?: string | null
  permissionMode?: PermissionMode | null
  effort?: EffortLevel | null
  ultracode?: boolean
}

export interface FileTab {
  id: string
  kind: 'file'
  projectId: string | null
  path: string
  title: string
}

export interface TerminalTab {
  id: string
  kind: 'terminal'
  projectId: string | null
  cwd: string
  title: string
  /** A command to type into the new shell once it is ready (cleared after) */
  run?: string
}

/** The getting-started steps, opened on the first launch and from Settings. */
export interface StartTab {
  id: string
  kind: 'start'
  projectId: null
  title: string
}

export interface SettingsTab {
  id: string
  kind: 'settings'
  projectId: null
  title: string
}

/** A web page shown inside Loom, usually a project's dev server. */
export interface BrowserTab {
  id: string
  kind: 'browser'
  projectId: string | null
  url: string
  title: string
  /** Width the page is shown at, to check phone and tablet layouts; null fills the pane */
  device?: number | null
}

/** The output of a dev server Loom started. Not saved: servers stop when Loom quits. */
export interface ServerTab {
  id: string
  kind: 'server'
  projectId: string | null
  serverId: string
  title: string
}

/** A file's changes: since the last commit, or in one commit. */
export interface DiffTab {
  id: string
  kind: 'diff'
  projectId: string | null
  path: string
  /** Show this commit's change to the file; none shows uncommitted changes */
  commit?: string
  title: string
}

export type Tab = ChatTab | FileTab | TerminalTab | SettingsTab | ServerTab | BrowserTab | DiffTab | StartTab

/** A tab's live state, handed from one window to another when it moves. */
export interface TabSnapshot {
  tab: Tab
  /** The chat's messages, status, approvals and draft, as the window had them */
  chat?: unknown
  dirty?: boolean
  /** Unsaved edits of a file tab */
  fileDraft?: string | null
}

// ---------- Dev servers ----------

/** Something a project can run, found in its package.json (or manage.py, or a compose file). */
export interface RunTarget {
  /** Stable within the project: folder plus script, e.g. ".#dev" or "newsroom#start" */
  id: string
  /** The script name, e.g. "dev" */
  script: string
  /** The sub folder it runs in, relative to the project ("" for the project folder) */
  where: string
  command: string
  cwd: string
  /** What the script runs, e.g. "next dev -p 3917" */
  detail?: string
}

export type ServerStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'exited'

export interface ServerInfo {
  id: string
  projectId: string
  target: RunTarget
  status: ServerStatus
  url: string | null
  exitCode: number | null
  startedAt: number
}

export type ClaudeSource = 'bundled' | 'installed' | 'custom'
export type ShellChoice = 'powershell' | 'cmd' | 'gitbash'

export interface LoomSettings {
  claudeSource: ClaudeSource
  claudeCustomPath: string
  shell: ShellChoice
  sendWithCtrlEnter: boolean
  defaultPermissionMode: PermissionMode | null
  /** What new chats start with: the last model, effort and Ultracode setting picked in any chat */
  defaultModel?: string | null
  defaultEffort?: EffortLevel | null
  defaultUltracode?: boolean
  notifyWhenDone: boolean
}

export interface ModelOption {
  value: string
  label: string
  description?: string
  resolved?: string
  efforts?: EffortLevel[]
}

/**
 * How the work area is split. A pane shows one tab; a split lays its children out side by side
 * (row) or stacked (column), sized by fractions that add up to 1.
 */
export type LayoutNode =
  | { kind: 'pane'; id: string; tabId: string | null }
  | { kind: 'split'; id: string; dir: 'row' | 'column'; sizes: number[]; children: LayoutNode[] }

export interface PersistedState {
  version: 1
  projects: Project[]
  groups: Group[]
  tabs: Tab[]
  activeTabId: string | null
  layout?: LayoutNode
  focusedPane?: string
  /** Set once someone has gone through, or skipped, the getting-started steps */
  onboarded?: boolean
  settings: LoomSettings
  sidebarWidth: number
  sidebarOpen: boolean
  rightPanelOpen: boolean
  rightPanelWidth: number
  rightPanelView: 'files' | 'changes' | 'claude'
  knownModels: ModelOption[]
}

export const DEFAULT_SETTINGS: LoomSettings = {
  claudeSource: 'bundled',
  claudeCustomPath: '',
  shell: 'powershell',
  sendWithCtrlEnter: false,
  defaultPermissionMode: 'default',
  notifyWhenDone: true
}

export const DEFAULT_MODELS: ModelOption[] = [
  { value: '', label: 'Default', description: 'The model your Claude settings choose' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
]

// ---------- Chat ----------

/** An image attached to a message: a small thumbnail, plus the full image or a way to fetch it. */
export interface ImagePreview {
  thumb: string | null
  /** The full image, when the window already has it (images sent in this session) */
  full?: string
  /** Asks the main process for the full image (images from saved chats) */
  ref?: string
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images: number; previews?: ImagePreview[]; ts?: string }
  | { kind: 'assistant'; id: string; text: string; ts?: string }
  /** ms: how long Claude thought, when known */
  | { kind: 'thinking'; id: string; text: string; ms?: number }
  | {
      kind: 'tool'
      id: string
      name: string
      summary: string
      detail?: string
      diff?: { before: string; after: string }
      filePath?: string
      result?: string
      isError?: boolean
      status: 'running' | 'done' | 'error'
      /** When it started (epoch ms), so a running tool can show how long it has been going */
      startedAt?: number
      /** How long it took, once finished */
      ms?: number
    }
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' | 'summary'; detail?: string }
  /** The end of a turn: how long Claude worked on it */
  | { kind: 'done'; id: string; ms: number }

export type ChatStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error'

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: QuestionOption[]
}

export interface PermissionRequest {
  requestId: string
  kind: 'tool' | 'question' | 'plan'
  toolName: string
  summary: string
  detail?: string
  diff?: { before: string; after: string }
  reason?: string
  canAlwaysAllow: boolean
  questions?: Question[]
  plan?: string
}

export type PermissionResponse =
  | { decision: 'allow' }
  | { decision: 'allow-always' }
  | { decision: 'deny'; message?: string }
  | { decision: 'answer'; answers: Record<string, string> }
  | { decision: 'approve-plan'; mode: PermissionMode }
  | { decision: 'reject-plan'; message?: string }

export interface SlashCommandInfo {
  name: string
  description: string
  /** Claude Code's own command, rather than a skill or command of yours */
  builtin?: boolean
  /** Where a skill comes from, as Claude Code labels it: user, project, a plugin */
  source?: string
}

/** How full a chat's context window is, in tokens. */
export interface ContextInfo {
  used: number
  max: number
  /** Kept free for summarizing: Claude summarizes earlier messages when `used` reaches max minus this */
  buffer: number
  /** Worked out from the saved conversation rather than asked of Claude */
  estimated?: boolean
}

export type ChatEvent =
  | { type: 'items'; items: ChatItem[] }
  | { type: 'tool-result'; toolUseId: string; result: string; isError: boolean; ms?: number }
  | { type: 'partial'; text: string }
  | { type: 'partial-clear' }
  | { type: 'status'; status: ChatStatus; error?: string }
  | { type: 'session'; sessionId: string; model?: string; permissionMode?: PermissionMode }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-done'; requestId: string }
  | { type: 'turn-done'; costUsd?: number; durationMs?: number; error?: string }
  | { type: 'models'; models: ModelOption[] }
  | { type: 'commands'; commands: SlashCommandInfo[] }
  | { type: 'mode'; permissionMode: PermissionMode }
  | { type: 'context'; context: ContextInfo }

export interface ChatStartOptions {
  cwd: string
  sessionId: string | null
  model: string | null
  permissionMode: PermissionMode | null
  effort: EffortLevel | null
  ultracode: boolean
}

export interface ImageAttachment {
  mediaType: string
  data: string // base64
  name: string
}

export interface SessionSummary {
  sessionId: string
  title: string
  cwd: string
  lastModified: number
  createdAt?: number
  gitBranch?: string
  fileSize?: number
}

export interface HistoryResult {
  items: ChatItem[]
  total: number
  error?: string
  context?: ContextInfo
}

// ---------- Files, git, terminals ----------

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export type FileReadResult =
  | { ok: true; content: string; mtime: number; eol: 'lf' | 'crlf' }
  | { ok: false; reason: 'binary' | 'too-large' | 'missing' | 'error'; message?: string; size?: number }

export interface GitStatus {
  branch: string | null
  changes: number
  ahead: number
  behind: number
  /** Where it pushes to (origin, else the first remote); null for a repository kept only on this PC */
  remote: string | null
}

/** A changed file. `index` and `work` are git's status letters for the staged and unstaged side. */
export interface GitFile {
  /** Relative to the repository root, with forward slashes */
  path: string
  abs: string
  index: string
  work: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
  /** The old name of a renamed file */
  from?: string
}

export interface GitChanges {
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
}

export interface GitCommit {
  hash: string
  short: string
  subject: string
  author: string
  /** epoch ms */
  at: number
}

export interface GitCommitFile {
  path: string
  abs: string
  status: string
}

export interface GitDiffResult {
  before: string
  after: string
  binary?: boolean
  error?: string
}

/** What a git command said, for showing when it fails. */
export interface GitResult {
  ok: boolean
  output: string
  /** Where copies of thrown-away changes were kept */
  backup?: string
}

export interface ClaudeInfo {
  bundledPath: string | null
  installedPath: string | null
  homeDir: string
  claudeDir: string
  defaultEffort: EffortLevel | null
  platform: string
}

/** Whether Claude Code is signed in on this PC, from `claude auth status`. */
export interface AuthStatus {
  loggedIn: boolean
  email?: string
  /** "max", "pro" and so on, for a Claude subscription */
  plan?: string
  /** "claude.ai", "console", an API key... */
  method?: string
  error?: string
}

export interface UsageLimit {
  key: string
  label: string
  percent: number
  resetsAt: number | null
  severity: 'normal' | 'warning' | 'critical'
  active: boolean
}

export interface UsageSnapshot {
  at: number
  plan: string | null
  available: boolean
  limits: UsageLimit[]
  /** The usage guard's weekly stop line, when the user has one set up */
  stopAt: number | null
  error?: string
}

export interface ConfigFileInfo {
  label: string
  path: string
  exists: boolean
  scope: 'global' | 'project'
}
