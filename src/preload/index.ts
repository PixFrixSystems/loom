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
  PermissionMode,
  PermissionResponse,
  PersistedState,
  RunTarget,
  ServerInfo,
  SessionSummary,
  SubFolder,
  SlashCommandInfo,
  Tab,
  TabSnapshot,
  UpdateStatus,
  UsageSnapshot
} from '@shared/types'

const api = {
  loadState: (): Promise<PersistedState> => ipcRenderer.invoke('state:load'),
  saveState: (state: PersistedState): void => ipcRenderer.send('state:save', state),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('app:pickFolder'),
  pickFile: (title: string): Promise<string | null> => ipcRenderer.invoke('app:pickFile', title),
  claudeInfo: (): Promise<ClaudeInfo> => ipcRenderer.invoke('app:claudeInfo'),
  authStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('claude:auth'),
  claudeProgram: (): Promise<string> => ipcRenderer.invoke('claude:program'),
  dirsExist: (paths: string[]): Promise<boolean[]> => ipcRenderer.invoke('fs:dirsExist', paths),
  subfolders: (dir: string): Promise<SubFolder[]> => ipcRenderer.invoke('fs:subfolders', dir),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('app:reveal', path),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('app:openPath', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  listSessions: (force?: boolean): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list', force),
  loadHistory: (sessionId: string): Promise<HistoryResult> => ipcRenderer.invoke('sessions:history', sessionId),
  renameSession: (sessionId: string, title: string): Promise<void> => ipcRenderer.invoke('sessions:rename', sessionId, title),
  moveSession: (sessionId: string, fromCwd: string, toCwd: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('sessions:move', sessionId, fromCwd, toCwd),

  chatOpen: (tabId: string, opts: ChatStartOptions): Promise<void> => ipcRenderer.invoke('chat:open', tabId, opts),
  chatSend: (tabId: string, text: string, images: ImageAttachment[]): Promise<void> =>
    ipcRenderer.invoke('chat:send', tabId, text, images),
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
  onUsage: (cb: (u: UsageSnapshot) => void): (() => void) => {
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
  serverStart: (projectId: string, target: RunTarget): Promise<ServerInfo> => ipcRenderer.invoke('server:start', projectId, target),
  serverStop: (id: string): Promise<void> => ipcRenderer.invoke('server:stop', id),
  serverRestart: (id: string): Promise<void> => ipcRenderer.invoke('server:restart', id),
  serverDismiss: (id: string): Promise<void> => ipcRenderer.invoke('server:dismiss', id),
  serverLog: (id: string): Promise<{ text: string; end: number } | null> => ipcRenderer.invoke('server:log', id),
  serverWrite: (id: string, data: string): void => ipcRenderer.send('server:write', id, data),
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  updateCheck: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  updateInstall: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  updateNotes: (): Promise<void> => ipcRenderer.invoke('update:notes'),
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
  }
}

export type LoomApi = typeof api

contextBridge.exposeInMainWorld('loom', api)
