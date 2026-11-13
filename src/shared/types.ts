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
  /** A folder the group watches: folders that appear inside it are offered as new projects. */
  watchPath?: string
  /** Names of folders in watchPath already offered (added or hidden), so only new ones show. */
  watchSeen?: string[]
}

/** A sub-agent or background task Claude started, while it runs. */
/** What the main window needs to know about a chat living in its own window. */
export interface PopoutChatState {
  status: ChatStatus
  permissions: PermissionRequest[]
  tasks: AgentTask[]
  unread: boolean
}

export interface AgentTask {
  id: string
  description: string
  /** The kind of agent ("Explore", "general-purpose"...) for a sub-agent */
  agentType?: string
  /** "local_agent", "local_bash", "local_workflow"...; absent from older Claude Code */
  taskType?: string
  /** Runs on while the chat does other things, or Claude waits for it */
  background: boolean
  /** The tool call that started it, the step in the chat that "Run in background" moves */
  toolUseId?: string
  startedAt: number
  lastTool?: string
  toolUses?: number
  /** One line on what it is doing, when Claude Code reports one */
  summary?: string
  /** Its latest steps, oldest first: "Read src/app.ts", "Bash Run the tests" */
  steps?: { text: string; at: number }[]
}

/** Where the installed app is with updates. */
export interface UpdateStatus {
  /** False for copies built from source, which update with git */
  enabled: boolean
  /** The version running now */
  version: string
  state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  /** The newer version found */
  available?: string
  percent?: number
  checkedAt?: number
  error?: string
}

/** A folder directly inside a watched one. */
export interface SubFolder {
  name: string
  path: string
  /** When it was created, in ms */
  created: number
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
  /** A message typed but not sent yet, kept across restarts */
  draft?: string
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
  /** Why it ended: something Loom recognised in its output, or the output's last error line */
  reason?: string | null
  /** It ended because the project's packages aren't installed, so installing them is the fix */
  needsInstall?: boolean
  /** Installing the project's packages first, before running it */
  installing?: boolean
  /** A server for this project that was already running when Loom tried to start one: Loom shows it, but didn't start it */
  adopted?: boolean
}

/** A public link to a dev server, through a Cloudflare Quick Tunnel, for showing a site to a client. */
export interface TunnelInfo {
  serverId: string
  /** starting: asking Cloudflare for a link; checking: it has one, waiting until it answers */
  state: 'starting' | 'checking' | 'live' | 'error'
  /** https://….trycloudflare.com, once Cloudflare has handed it out */
  url?: string
  /** The server's own path ("/base/"), added to the link; empty at the root */
  path: string
  /** Live without having answered Loom's check yet: it may take a little longer to open */
  slow?: boolean
  error?: string
  startedAt: number
}

/** How to install a Node project's packages: the command, and the folder it runs in. */
export interface InstallStep {
  /** e.g. "npm install" */
  command: string
  /** The project's folder, or the workspace root it belongs to */
  cwd: string
}

export type ClaudeSource = 'bundled' | 'installed' | 'custom'
export type ShellChoice = 'powershell' | 'cmd' | 'gitbash'

export type NotifySound = 'off' | 'chime' | 'glass' | 'pluck' | 'rise'

export interface LoomSettings {
  claudeSource: ClaudeSource
  claudeCustomPath: string
  shell: ShellChoice
  sendWithCtrlEnter: boolean
  defaultPermissionMode: PermissionMode | null
  /** What new chats start with: the last model, effort and Ultracode setting picked in any chat */
  defaultModel?: string | null
  /**
   * The model every new chat starts with, chosen in Settings. Unset: the last one picked in a chat
   * (defaultModel). '': Claude Code's own default. Otherwise a model, and picking another in a chat
   * changes only that chat.
   */
  newChatModel?: string | null
  defaultEffort?: EffortLevel | null
  defaultUltracode?: boolean
  notifyWhenDone: boolean
  /** A sound Loom plays itself when it would notify; works even with Windows notifications off */
  notifySound?: NotifySound
  /** How loud that sound plays, 0 to 100 */
  notifyVolume?: number
  /** Days to keep the copies a moved chat leaves in ~/.claude/chat-backups; 0 keeps them forever */
  keepChatBackupsDays?: number
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
  notifyWhenDone: true,
  keepChatBackupsDays: 30
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

/** Every item may carry `ts`, when it happened (ISO): saved ones have it, live ones get it as they arrive. */
export type ChatItem =
  /** `background`: sent with "Send to background", for Claude to hand to a background agent */
  | { kind: 'user'; id: string; text: string; images: number; previews?: ImagePreview[]; ts?: string; background?: boolean }
  | { kind: 'assistant'; id: string; text: string; ts?: string }
  /** ms: how long Claude thought, when known */
  | { kind: 'thinking'; id: string; text: string; ms?: number; ts?: string }
  | {
      kind: 'tool'
      id: string
      ts?: string
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
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' | 'summary'; detail?: string; ts?: string }
  /** The end of a turn: how long Claude worked on it */
  | { kind: 'done'; id: string; ms: number; ts?: string }

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
  /** What it takes after the name, such as "<file>" */
  hint?: string
  /** For your own skills: where one came from, when known (its repository or author) */
  origin?: string
  /** The same in full, for a tooltip: "Installed from heygen-com/hyperframes" */
  originDetail?: string
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
  /** The sub-agents and background tasks running in this chat right now */
  | { type: 'tasks'; tasks: AgentTask[] }
  /** A task that ran in the background has ended; Claude picks its result up */
  | { type: 'task-done'; description: string; status: 'completed' | 'failed' | 'stopped' }
  /** Claude's thinking so far, while it is still thinking */
  | { type: 'thinking-partial'; text: string }
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
  /** Messages sent while Claude worked that Stop cancelled before Claude read them: they go back in the box */
  | { type: 'unsent'; ids: string[] }
  /** What Claude Code is doing besides answering, such as compacting the conversation */
  | { type: 'activity'; activity: 'compacting' | null }

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
  | { ok: true; content: string; mtime: number; eol: 'lf' | 'crlf'; bom: boolean }
  | { ok: false; reason: 'binary' | 'too-large' | 'missing' | 'encoding' | 'error'; message?: string; size?: number }

export interface FileWriteOptions {
  /** Start the file with a UTF-8 byte order mark, as it had one when read */
  bom?: boolean
  /** The modified time the editor last saw. A newer file on disk is not overwritten. */
  expectMtime?: number
}

export type FileWriteResult =
  | { ok: true; mtime: number }
  | { ok: false; reason: 'changed' | 'error'; mtime?: number; message?: string }

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
/** Signing in to Claude, as Loom shows it */
export interface LoginState {
  status: 'idle' | 'waiting' | 'done' | 'failed'
  /** The sign-in page, once Claude Code has said where it is */
  url?: string
  /** Why it failed */
  message?: string
}

export interface AuthStatus {
  loggedIn: boolean
  email?: string
  /** "max", "pro" and so on, for a Claude subscription */
  plan?: string
  /** "claude.ai", "console", an API key... */
  method?: string
  /** No Claude Code program on this PC to ask */
  missing?: boolean
  error?: string
}

/** A service besides Claude that this PC can be signed in to */
export type ServiceId = 'github' | 'cloudflare' | 'vercel'

/** How signing in to or out of a service happens: Loom does it itself, or a command runs in a terminal */
export type SignStep = { direct: true } | { run: string }

/** Who this PC is signed in as on a service, as that service's own tool has it */
export interface ServiceAccount {
  id: ServiceId
  signedIn: boolean
  /** A GitHub login, a Cloudflare email, a Vercel username. Missing when signed in but the name can't be read now. */
  who?: string
  /** More accounts of the same service (GitHub can hold several) */
  others?: string[]
  /** What holds the sign-in, as it reads after "through": "Git's credential manager", "Wrangler" */
  via?: string
  /** One more sentence: Cloudflare's account names, the name git puts on commits */
  detail?: string
  signIn?: SignStep
  signOut?: SignStep
}

export interface UsageLimit {
  key: string
  label: string
  percent: number
  resetsAt: number | null
  severity: 'normal' | 'warning' | 'critical'
  /**
   * The server's headline pick: the one row a single-number indicator would show (the Fable week,
   * say, while that is the tightest). Every row counts whether or not it is the pick.
   */
  active: boolean
}

export interface UsageSnapshot {
  at: number
  plan: string | null
  available: boolean
  limits: UsageLimit[]
  /** The usage guard's weekly stop line, when the user has one set up */
  stopAt: number | null
  /** The account these limits belong to */
  email?: string
  error?: string
}

export interface ConfigFileInfo {
  label: string
  path: string
  exists: boolean
  scope: 'global' | 'project'
}
