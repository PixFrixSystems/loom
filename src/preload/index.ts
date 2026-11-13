import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AuthStatus,
  ChatEvent,
  ChatStartOptions,
  ClaudeInfo,
  ConfigFileInfo,
  DirEntry,
  FileReadResult,
  FileWriteOptions,
  FileWriteResult,
  GitChanges,
  GitCommit,
  GitCommitFile,
  GitDiffResult,
  GitResult,
  GitStatus,
  EffortLevel,
  HistoryResult,
  ImageAttachment,
  LoginState,
  ModelOption,
  NotifySound,
  InstallStep,
  PermissionMode,
  PermissionResponse,
  PersistedState,
  PopoutChatState,
  RunTarget,
  ServerInfo,
  SessionSummary,
  TunnelInfo,
  SubFolder,
  SlashCommandInfo,
  Tab,
  TabSnapshot,
  ServiceAccount,
  ServiceId,
  UpdateStatus,
  UsageSnapshot
} from '@shared/types'
import type { PhoneAction, RemoteList, RemoteStatus, ToPhone } from '@shared/remote'

const api = {
  loadState: (): Promise<PersistedState> => ipcRenderer.invoke('state:load'),
  saveState: (state: PersistedState): void => ipcRenderer.send('state:save', state),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('app:pickFolder'),
  pickFile: (title: string): Promise<string | null> => ipcRenderer.invoke('app:pickFile', title),
  claudeInfo: (): Promise<ClaudeInfo> => ipcRenderer.invoke('app:claudeInfo'),
  authStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('claude:auth'),
  /** Signs Claude Code out on this PC */
  logout: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('claude:logout'),
  /** Tells the main process another account is now signed in */
  accountChanged: (): void => ipcRenderer.send('claude:accountChanged'),
  /** Who this PC is signed in as on GitHub, Cloudflare or Vercel; null when it couldn't be looked up */
  serviceAccount: (id: ServiceId, force?: boolean): Promise<ServiceAccount | null> => ipcRenderer.invoke('accounts:get', id, force),
  /** Signs in to or out of GitHub through Git's credential manager, which shows its own window */
  githubSign: (what: 'in' | 'out', login?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('accounts:github', what, login),
  /** Starts signing in to Claude in the background (claude auth login) */
  loginStart: (): Promise<LoginState> => ipcRenderer.invoke('login:start'),
  loginState: (): Promise<LoginState> => ipcRenderer.invoke('login:state'),
  /** The code the sign-in page shows, when it shows one */
  loginCode: (code: string): void => ipcRenderer.send('login:code', code),
  loginCancel: (): void => ipcRenderer.send('login:cancel'),
  onLoginState: (cb: (state: LoginState) => void): (() => void) => {
    const listener = (_e: unknown, state: LoginState): void => cb(state)
    ipcRenderer.on('login:state', listener)
    return () => ipcRenderer.removeListener('login:state', listener)
  },
  claudeProgram: (): Promise<string> => ipcRenderer.invoke('claude:program'),
  dirsExist: (paths: string[]): Promise<boolean[]> => ipcRenderer.invoke('fs:dirsExist', paths),
  subfolders: (dir: string): Promise<SubFolder[]> => ipcRenderer.invoke('fs:subfolders', dir),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('app:reveal', path),
  /** Whether Windows has notifications switched off, for every app or for Loom */
  notifyOff: (): Promise<boolean> => ipcRenderer.invoke('app:notifyOff'),
  /** Sends a test notification (and plays the sound), even with Loom in front */
  notifyTest: (): void => ipcRenderer.send('app:notifyTest'),
  /** Opens Windows' notification settings */
  notifySettings: (): void => ipcRenderer.send('app:notifySettings'),
  /** A question from the main process (before quitting or restarting) for Loom's own dialog */
  onAsk: (cb: (id: string, req: unknown) => void): (() => void) => {
    const listener = (_e: unknown, id: string, req: unknown): void => cb(id, req)
    ipcRenderer.on('app:ask', listener)
    return () => ipcRenderer.removeListener('app:ask', listener)
  },
  askShown: (id: string): void => ipcRenderer.send('app:askShown', id),
  askReply: (id: string, choice: string): void => ipcRenderer.send('app:askReply', id, choice),
  onNotifySound: (cb: (sound: NotifySound) => void): (() => void) => {
    const listener = (_e: unknown, sound: NotifySound): void => cb(sound)
    ipcRenderer.on('app:notifySound', listener)
    return () => ipcRenderer.removeListener('app:notifySound', listener)
  },
  /** Puts an image (a data: URL) on the clipboard; false when it isn't one */
  copyImage: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('app:copyImage', dataUrl),
  reportUnsaved: (names: string[]): void => ipcRenderer.send('app:unsaved', names),
  createEntry: (path: string, kind: 'file' | 'folder'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('fs:create', path, kind),
  renameEntry: (from: string, to: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('fs:rename', from, to),
  trashEntry: (path: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('fs:trash', path),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('app:openPath', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  listSessions: (force?: boolean): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list', force),
  loadHistory: (sessionId: string): Promise<HistoryResult> => ipcRenderer.invoke('sessions:history', sessionId),
  renameSession: (sessionId: string, title: string): Promise<void> => ipcRenderer.invoke('sessions:rename', sessionId, title),
  moveSession: (sessionId: string, fromCwd: string, toCwd: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('sessions:move', sessionId, fromCwd, toCwd),

  chatOpen: (tabId: string, opts: ChatStartOptions): Promise<void> => ipcRenderer.invoke('chat:open', tabId, opts),
  chatSend: (tabId: string, text: string, images: ImageAttachment[], id?: string, background?: boolean): Promise<void> =>
    ipcRenderer.invoke('chat:send', tabId, text, images, id, background),
  /** Moves the running command or agent started by that tool call to the background */
  chatBackground: (tabId: string, toolUseId: string): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('chat:background', tabId, toolUseId),
  chatInterrupt: (tabId: string): Promise<void> => ipcRenderer.invoke('chat:interrupt', tabId),
  chatStopTask: (tabId: string, taskId: string): Promise<void> => ipcRenderer.invoke('chat:stopTask', tabId, taskId),
  chatSetModel: (tabId: string, model: string | null): Promise<void> => ipcRenderer.invoke('chat:setModel', tabId, model),
  chatSetMode: (tabId: string, mode: PermissionMode): Promise<void> => ipcRenderer.invoke('chat:setMode', tabId, mode),
  chatSetEffort: (tabId: string, effort: EffortLevel | null, ultracode: boolean): Promise<void> =>
    ipcRenderer.invoke('chat:setEffort', tabId, effort, ultracode),
  chatRespond: (tabId: string, requestId: string, response: PermissionResponse): Promise<void> =>
    ipcRenderer.invoke('chat:respond', tabId, requestId, response),
  chatClose: (tabId: string): Promise<void> => ipcRenderer.invoke('chat:close', tabId),
  commandsList: (cwd: string): Promise<SlashCommandInfo[]> => ipcRenderer.invoke('commands:list', cwd),
  /** Loom shortcuts pressed while a browser tab's page had the keyboard */
  onBrowserShortcut: (cb: (k: { key: string; code: string; shift: boolean; alt: boolean }) => void): (() => void) => {
    const listener = (_e: unknown, k: { key: string; code: string; shift: boolean; alt: boolean }): void => cb(k)
    ipcRenderer.on('browser:shortcut', listener)
    return () => ipcRenderer.removeListener('browser:shortcut', listener)
  },
  onChatEvent: (cb: (tabId: string, event: ChatEvent) => void): (() => void) => {
    const listener = (_e: unknown, tabId: string, event: ChatEvent): void => cb(tabId, event)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.removeListener('chat:event', listener)
  },

  listDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:listDir', dir),
  readFile: (path: string): Promise<FileReadResult> => ipcRenderer.invoke('fs:read', path),
  writeFile: (path: string, content: string, opts?: FileWriteOptions): Promise<FileWriteResult> => ipcRenderer.invoke('fs:write', path, content, opts),
  fileMtime: (path: string): Promise<number | null> => ipcRenderer.invoke('fs:mtime', path),
  projectFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:projectFiles', root),
  configFiles: (projectPath: string | null): Promise<ConfigFileInfo[]> => ipcRenderer.invoke('fs:configFiles', projectPath),
  gitStatus: (dir: string): Promise<GitStatus | null> => ipcRenderer.invoke('git:status', dir),
  gitChanges: (dir: string): Promise<GitChanges | null> => ipcRenderer.invoke('git:changes', dir),
  gitDiff: (dir: string, abs: string, commit: string | null): Promise<GitDiffResult> => ipcRenderer.invoke('git:diff', dir, abs, commit),
  gitStage: (dir: string, abs: string[]): Promise<GitResult> => ipcRenderer.invoke('git:stage', dir, abs),
  gitUnstage: (dir: string, abs: string[]): Promise<GitResult> => ipcRenderer.invoke('git:unstage', dir, abs),
  gitDiscard: (dir: string, files: { abs: string; untracked: boolean; added: boolean }[]): Promise<GitResult> =>
    ipcRenderer.invoke('git:discard', dir, files),
  gitCommit: (dir: string, message: string, stageAll: boolean, only?: string[]): Promise<GitResult> =>
    ipcRenderer.invoke('git:commit', dir, message, stageAll, only),
  gitPush: (dir: string): Promise<GitResult> => ipcRenderer.invoke('git:push', dir),
  gitPull: (dir: string): Promise<GitResult> => ipcRenderer.invoke('git:pull', dir),
  gitBranches: (dir: string): Promise<{ current: string | null; branches: string[] }> => ipcRenderer.invoke('git:branches', dir),
  gitSwitch: (dir: string, branch: string, create: boolean): Promise<GitResult> => ipcRenderer.invoke('git:switch', dir, branch, create),
  gitLog: (dir: string): Promise<GitCommit[]> => ipcRenderer.invoke('git:log', dir),
  gitCommitFiles: (dir: string, hash: string): Promise<GitCommitFile[]> => ipcRenderer.invoke('git:commitFiles', dir, hash),
  gitWriteMessage: (dir: string, only?: string[]): Promise<{ message?: string; error?: string }> => ipcRenderer.invoke('git:writeMessage', dir, only),
  projectIcon: (root: string, mode: string, customPath: string | null, others: string[]): Promise<string | null> =>
    ipcRenderer.invoke('project:icon', root, mode, customPath, others),
  pickIcon: (title?: string): Promise<string | null> => ipcRenderer.invoke('project:pickIcon', title),
  readIcon: (path: string): Promise<string | null> => ipcRenderer.invoke('icon:read', path),
  fullImage: (ref: string): Promise<string | null> => ipcRenderer.invoke('image:full', ref),
  getUsage: (force?: boolean): Promise<UsageSnapshot | null> => ipcRenderer.invoke('usage:get', force),
  /** The models the signed-in account can use, whenever Loom asks Claude Code again */
  onModels: (cb: (models: ModelOption[]) => void): (() => void) => {
    const listener = (_e: unknown, models: ModelOption[]): void => cb(models)
    ipcRenderer.on('models:update', listener)
    return () => ipcRenderer.removeListener('models:update', listener)
  },
  onUsage: (cb: (u: UsageSnapshot | null) => void): (() => void) => {
    const listener = (_e: unknown, u: UsageSnapshot): void => cb(u)
    ipcRenderer.on('usage:update', listener)
    return () => ipcRenderer.removeListener('usage:update', listener)
  },

  ptyCreate: (id: string, cwd: string, cols: number, rows: number): Promise<{ ok: true; replay?: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('pty:create', id, cwd, cols, rows),
  ptyWrite: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),
  onPtyData: (cb: (id: string, data: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string, data: string): void => cb(id, data)
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.removeListener('pty:data', listener)
  },
  onPtyExit: (cb: (id: string, code: number) => void): (() => void) => {
    const listener = (_e: unknown, id: string, code: number): void => cb(id, code)
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.removeListener('pty:exit', listener)
  },

  // Tabs in windows of their own
  popoutOpen: (tab: Tab, at?: { x: number; y: number }): Promise<void> => ipcRenderer.invoke('popout:open', tab, at),
  popoutInit: (): Promise<{ tab: Tab; snapshot: TabSnapshot | null } | null> => ipcRenderer.invoke('popout:init'),
  popoutReady: (): void => ipcRenderer.send('popout:ready'),
  popoutClose: (tabId: string): Promise<void> => ipcRenderer.invoke('popout:close', tabId),
  popoutDiscard: (tabId: string): Promise<void> => ipcRenderer.invoke('popout:discard', tabId),
  popoutFocus: (tabId: string): Promise<void> => ipcRenderer.invoke('popout:focus', tabId),
  popoutTab: (tab: Tab): void => ipcRenderer.send('popout:tab', tab),
  mainDo: (action: string, args: unknown[]): void => ipcRenderer.send('popout:main-do', action, args),
  /** Answers the main process when it needs a tab's live state to move it. */
  onSnapshotRequest: (cb: (tabId: string) => TabSnapshot | null): (() => void) => {
    const listener = (_e: unknown, tabId: string): void => ipcRenderer.send('popout:snapshot', tabId, cb(tabId))
    ipcRenderer.on('popout:snapshot-request', listener)
    return () => ipcRenderer.removeListener('popout:snapshot-request', listener)
  },
  onPopoutReturned: (cb: (tabId: string, snapshot: TabSnapshot | null) => void): (() => void) => {
    const listener = (_e: unknown, tabId: string, snapshot: TabSnapshot | null): void => cb(tabId, snapshot)
    ipcRenderer.on('popout:returned', listener)
    return () => ipcRenderer.removeListener('popout:returned', listener)
  },
  popoutChatState: (tabId: string, state: PopoutChatState): void => ipcRenderer.send('popout:chat-state', tabId, state),
  onPopoutChatState: (cb: (tabId: string, state: PopoutChatState) => void): (() => void) => {
    const listener = (_e: unknown, tabId: string, state: PopoutChatState): void => cb(tabId, state)
    ipcRenderer.on('popout:chat-state', listener)
    return () => ipcRenderer.removeListener('popout:chat-state', listener)
  },
  onPopoutTab: (cb: (tab: Tab) => void): (() => void) => {
    const listener = (_e: unknown, tab: Tab): void => cb(tab)
    ipcRenderer.on('popout:tab', listener)
    return () => ipcRenderer.removeListener('popout:tab', listener)
  },
  onMainDo: (cb: (action: string, args: unknown[]) => void): (() => void) => {
    const listener = (_e: unknown, action: string, args: unknown[]): void => cb(action, args)
    ipcRenderer.on('main:do', listener)
    return () => ipcRenderer.removeListener('main:do', listener)
  },

  detectRun: (root: string, others: string[]): Promise<RunTarget[]> => ipcRenderer.invoke('run:detect', root, others),
  serverList: (): Promise<ServerInfo[]> => ipcRenderer.invoke('server:list'),
  serverStart: (projectId: string, target: RunTarget, install?: boolean): Promise<ServerInfo> =>
    ipcRenderer.invoke('server:start', projectId, target, install),
  /** How to install a target's packages when it lists some that were never installed, else null */
  serverMissingPackages: (target: RunTarget): Promise<InstallStep | null> => ipcRenderer.invoke('server:missingPackages', target),
  serverStop: (id: string): Promise<void> => ipcRenderer.invoke('server:stop', id),
  serverRestart: (id: string, install?: boolean): Promise<void> => ipcRenderer.invoke('server:restart', id, install),
  serverDismiss: (id: string): Promise<void> => ipcRenderer.invoke('server:dismiss', id),
  serverLog: (id: string): Promise<{ text: string; end: number } | null> => ipcRenderer.invoke('server:log', id),
  serverWrite: (id: string, data: string): void => ipcRenderer.send('server:write', id, data),
  /** Public links to dev servers, through Cloudflare Quick Tunnels */
  tunnelList: (): Promise<TunnelInfo[]> => ipcRenderer.invoke('tunnel:list'),
  /** Whether cloudflared is on this PC */
  tunnelAvailable: (): Promise<boolean> => ipcRenderer.invoke('tunnel:available'),
  tunnelStart: (serverId: string): Promise<{ ok: boolean; missing?: boolean; message?: string }> => ipcRenderer.invoke('tunnel:start', serverId),
  tunnelStop: (serverId: string): Promise<void> => ipcRenderer.invoke('tunnel:stop', serverId),
  onTunnels: (cb: (list: TunnelInfo[]) => void): (() => void) => {
    const listener = (_e: unknown, list: TunnelInfo[]): void => cb(list)
    ipcRenderer.on('tunnel:update', listener)
    return () => ipcRenderer.removeListener('tunnel:update', listener)
  },
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  updateCheck: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  updateInstall: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  /** Release notes on GitHub: of `version` when given */
  updateNotes: (version?: string): Promise<void> => ipcRenderer.invoke('update:notes', version),
  onUpdate: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  onServers: (cb: (list: ServerInfo[]) => void): (() => void) => {
    const listener = (_e: unknown, list: ServerInfo[]): void => cb(list)
    ipcRenderer.on('server:update', listener)
    return () => ipcRenderer.removeListener('server:update', listener)
  },
  onServerData: (cb: (id: string, data: string, end: number) => void): (() => void) => {
    const listener = (_e: unknown, id: string, data: string, end: number): void => cb(id, data, end)
    ipcRenderer.on('server:data', listener)
    return () => ipcRenderer.removeListener('server:data', listener)
  },

  // Phone access: the settings, then what a window tells linked phones and hears from them.
  remoteStatus: (): Promise<RemoteStatus> => ipcRenderer.invoke('remote:status'),
  remoteEnable: (on: boolean): Promise<RemoteStatus> => ipcRenderer.invoke('remote:enable', on),
  remotePair: (): Promise<RemoteStatus> => ipcRenderer.invoke('remote:pair'),
  remotePairCancel: (): Promise<RemoteStatus> => ipcRenderer.invoke('remote:pairCancel'),
  /** Allows or refuses a phone that scanned the code */
  remoteAnswerLink: (id: string, allow: boolean): Promise<RemoteStatus> => ipcRenderer.invoke('remote:answerLink', id, allow),
  remoteRemove: (id: string): Promise<RemoteStatus> => ipcRenderer.invoke('remote:remove', id),
  onRemoteStatus: (cb: (status: RemoteStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: RemoteStatus): void => cb(status)
    ipcRenderer.on('remote:status', listener)
    return () => ipcRenderer.removeListener('remote:status', listener)
  },
  /** The chats phones have open right now */
  remoteWatching: (): Promise<string[]> => ipcRenderer.invoke('remote:watching'),
  onRemoteWatching: (cb: (tabIds: string[]) => void): void => {
    ipcRenderer.on('remote:watching', (_e, tabIds: string[]) => cb(tabIds))
  },
  /** A phone opened a chat: it wants the chat as it is now */
  onRemoteOpen: (cb: (tabId: string, device: string) => void): void => {
    ipcRenderer.on('remote:open', (_e, tabId: string, device: string) => cb(tabId, device))
  },
  onRemoteAct: (cb: (action: PhoneAction, device: string) => void): void => {
    ipcRenderer.on('remote:act', (_e, action: PhoneAction, device: string) => cb(action, device))
  },
  onRemoteListRequest: (cb: () => void): void => {
    ipcRenderer.on('remote:list-request', () => cb())
  },
  /** For the phones that have this chat open, or only the one named */
  remotePush: (msg: ToPhone, to?: string): void => ipcRenderer.send('remote:push', msg, to),
  /** For every connected phone, or only the one named: project icons, saved chats, a chat just opened */
  remoteTell: (msg: ToPhone, to?: string): void => ipcRenderer.send('remote:tell', msg, to),
  remoteList: (list: RemoteList): void => ipcRenderer.send('remote:list', list)
}

export type LoomApi = typeof api

contextBridge.exposeInMainWorld('loom', api)
