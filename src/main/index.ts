import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, Notification, shell, session, type BrowserWindowConstructorOptions } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installingUpdate, setupUpdates } from './updates'
import type {
  ChatStartOptions,
  EffortLevel,
  FileWriteOptions,
  ImageAttachment,
  LoomSettings,
  PermissionMode,
  PermissionResponse,
  PersistedState,
  RunTarget
} from '@shared/types'
import {
  claudeAuthStatus,
  claudeLogout,
  modelOptions,
  releaseIdleChats,
  claudeInfo,
  claudeProgram,
  closeAllChats,
  closeChat,
  commandsFor,
  executableFor,
  getChat,
  listAllSessions,
  liveQuery,
  loadSdk,
  moveSession,
  pruneChatBackups,
  loadHistory,
  openChat,
  renameSession,
  runningChats,
  writeCommitMessage
} from './claude'
import {
  diffForMessage,
  gitBranches,
  gitChanges,
  gitCommit,
  gitCommitFiles,
  gitDiff,
  gitDiscard,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitSwitch,
  gitUnstage
} from './git'
import { detectProjectIcon, iconDataUrl } from './icons'
import { finishThumbnails, fullImage } from './images'
import { forgetUsage, lastUsage, refreshUsage } from './usage'
import { configFiles, createEntry, dirsExist, fileMtime, gitStatus, listDir, listProjectFiles, listSubfolders, readTextFile, renameEntry, writeTextFile } from './files'
import { createTerminal, killAllTerminals, killTerminal, resizeTerminal, writeTerminal } from './pty'
import {
  detectRunTargets,
  dismissServer,
  killAllServers,
  listServers,
  missingPackages,
  restartServer,
  serverLog,
  startServer,
  stopServer,
  writeServer
} from './servers'
import { closeAllPopouts, setupPopouts } from './popouts'
import { closeRemote, setupRemote } from './remote'
import { cancelLogin, loginState, startLogin, submitLoginCode } from './login'
import { emptyState, flushBounds, flushState, loadBounds, loadState, saveBounds, saveState } from './state'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

// Tests point Loom at a scratch folder so they never touch the real state.
if (process.env.LOOM_USER_DATA) app.setPath('userData', process.env.LOOM_USER_DATA)

// One Loom at a time. A second launch brings the first to the front and quits without doing
// anything itself: it doesn't read the state file, open a window or start the updater.
const primary = app.requestSingleInstanceLock()

let win: BrowserWindow | null = null
let state: PersistedState = primary ? loadState() : emptyState()
const settings = (): LoomSettings => state.settings

if (!primary) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

// The installed app and a copy built from source get separate Windows identities, so Windows
// never shows one's name or icon on the other's taskbar button, and their shortcuts don't fight.
const APP_ID = app.isPackaged ? 'gr.pixfrix.loom' : 'gr.pixfrix.loom.source'
app.setAppUserModelId(APP_ID)
app.setName('Loom')

/** What every Loom window shares: the frame, the colours, the preload bridge. */
function windowOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    title: 'Loom',
    backgroundColor: '#0c0e15',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#12141b', symbolColor: '#a9afbf', height: 42 },
    // An .ico on Windows: the taskbar shows it, where it would show electron.exe's icon instead of a PNG.
    icon: join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Notification sounds play while Loom is in the background, without a click first.
      autoplayPolicy: 'no-user-gesture-required',
      // Browser tabs show sites in a <webview>, locked down below.
      webviewTag: true
    }
  }
}

/**
 * Electron's default menu comes with a browser's shortcuts, all live even with no menu bar shown:
 * Ctrl+R reloaded Loom and lost unsaved edits and drafts, Ctrl+Shift+I opened DevTools on Loom,
 * Ctrl+W closed the window. Loom keeps only zoom; the window draws its own title bar, so no menu
 * bar appears. Running from source (dev) keeps the default menu, reload and DevTools included.
 */
function installMenu(): void {
  if (isDev) return
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }]))
}

const APP_KEYS = ['w', 't', 'p', 'tab', '\\', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Browser tabs: the site runs in its own sandboxed page with no access to Loom, links that
 * open new windows go to the real browser, and Loom's shortcuts still work while the page has focus.
 */
function lockDownPreviews(): void {
  // Electron grants a page every permission it asks for unless told otherwise: camera, microphone,
  // location, notifications, reading the clipboard, opening other apps through their own links.
  // A site under development gets none of that; going full screen and copying still work.
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write'])
  const preview = session.fromPartition('persist:loom-preview')
  preview.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  preview.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e, prefs, params) => {
      delete (prefs as { preload?: string }).preload
      prefs.nodeIntegration = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      if (!/^https?:\/\//i.test(params.src) && params.src !== 'about:blank') e.preventDefault()
    })
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (input.key === 'F5' || (input.control && key === 'r')) {
        e.preventDefault()
        if (input.shift) contents.reloadIgnoringCache()
        else contents.reload()
      } else if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
        e.preventDefault()
        contents.toggleDevTools()
      } else if (input.control && (APP_KEYS.includes(key) || (input.alt && input.key.startsWith('Arrow')))) {
        e.preventDefault()
        contents.hostWebContents?.send('browser:shortcut', { key: input.key, code: input.code, shift: input.shift, alt: input.alt })
      }
    })
  })
}

/** Links open in the browser; the window itself never navigates away. */
function guardNavigation(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
}

function loadRenderer(w: BrowserWindow, query: Record<string, string> = {}): void {
  if (isDev) {
    const qs = new URLSearchParams(query).toString()
    void w.loadURL(`${process.env.ELECTRON_RENDERER_URL!}${qs ? `?${qs}` : ''}`)
  } else void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function createWindow(): void {
  const bounds = loadBounds()
  win = new BrowserWindow({
    ...windowOptions(),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 880,
    minHeight: 560
  })
  if (bounds.maximized) win.maximize()
  // A copy built from source runs inside electron.exe. Without this, pinning its window to
  // Start or the taskbar makes an "Electron" shortcut that opens a blank Electron.
  if (process.platform === 'win32' && !app.isPackaged) {
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: join(app.getAppPath(), 'resources', 'icon.ico'),
      relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Loom (source)'
    })
  }

  win.once('ready-to-show', () => {
    win?.show()
    // After an update the installer starts Loom again with --updated. Windows can leave a window
    // shown by a process the installer started behind the others, so it is brought to the front.
    if (process.argv.includes('--updated')) {
      win?.moveTop()
      win?.focus()
    }
  })

  const rememberBounds = (): void => {
    if (!win) return
    const b = win.getNormalBounds()
    saveBounds({ ...b, maximized: win.isMaximized() })
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)

  win.on('close', (e) => {
    if (closeConfirmed) return
    const busy = runningChats()
    const unsaved = unsavedFiles()
    if ((busy > 0 || unsaved.length) && win && !installingUpdate()) {
      // Asked in Loom's own dialog, so the window stays open while it waits for the answer.
      e.preventDefault()
      if (askingToClose) return
      askingToClose = true
      void confirmLoss('Quitting', 'Quit anyway', 'Cancel').then((go) => {
        askingToClose = false
        if (!go || !win) return
        closeConfirmed = true
        win.close()
      })
    }
  })

  // Tabs in their own windows close with the main one; the app then quits.
  win.on('closed', () => {
    win = null
    closeAllPopouts()
  })

  guardNavigation(win)
  loadRenderer(win)
}

// Files with unsaved edits, as each Loom window last reported them (popped-out ones too).
const unsavedByWindow = new Map<number, string[]>()
function unsavedFiles(): string[] {
  return [...unsavedByWindow.values()].flat()
}

let closeConfirmed = false
let askingToClose = false

/**
 * Asks before quitting or restarting would stop chats or lose unsaved files, in Loom's own themed
 * dialog. A window that doesn't take the question within a moment (it hung) gets Windows' own
 * dialog instead, so Loom can always be closed.
 */
async function confirmLoss(doing: 'Quitting' | 'Restarting', go: string, stay: string): Promise<boolean> {
  const busy = runningChats()
  const unsaved = unsavedFiles()
  if (!busy && !unsaved.length) return true
  const { message, detail } = whatQuittingLoses(busy, unsaved, doing)
  const target = win
  if (!target || target.webContents.isDestroyed()) return true
  const id = randomUUID()
  const answer = new Promise<string | null>((resolve) => {
    let taken = false
    const onShown = (_e: unknown, shownId: string): void => {
      if (shownId === id) taken = true
    }
    const onReply = (_e: unknown, replyId: string, choice: string): void => {
      if (replyId !== id) return
      ipcMain.removeListener('app:askShown', onShown)
      ipcMain.removeListener('app:askReply', onReply)
      resolve(choice)
    }
    ipcMain.on('app:askShown', onShown)
    ipcMain.on('app:askReply', onReply)
    setTimeout(() => {
      if (taken) return
      ipcMain.removeListener('app:askShown', onShown)
      ipcMain.removeListener('app:askReply', onReply)
      resolve(null)
    }, 2000)
  })
  target.webContents.send('app:ask', id, {
    title: doing === 'Quitting' ? 'Quit Loom?' : 'Restart Loom to update?',
    body: `${message} ${detail}`,
    items: unsaved.length > 1 ? unsaved : undefined,
    choices: [
      { id: 'go', label: go, kind: unsaved.length ? 'danger' : 'primary' },
      { id: 'stay', label: stay, kind: 'ghost' }
    ],
    cancel: 'stay',
    focus: 'stay'
  })
  const choice = await answer
  if (choice !== null) return choice === 'go'
  if (target.isDestroyed()) return true
  const fallback = dialog.showMessageBoxSync(target, { type: 'question', buttons: [go, stay], defaultId: 1, cancelId: 1, title: 'Loom', message, detail })
  return fallback === 0
}

/** What closing Loom would cost, for the question asked before quitting or restarting. */
function whatQuittingLoses(busy: number, unsaved: string[], doing: string): { message: string; detail: string } {
  const files = unsaved.length === 1 ? `${unsaved[0]} has unsaved changes.` : unsaved.length ? `${unsaved.length} files have unsaved changes.` : ''
  const chats = busy === 1 ? 'A chat is still working.' : busy ? `${busy} chats are still working.` : ''
  return {
    message: [files, chats].filter(Boolean).join(' '),
    detail: [
      unsaved.length ? `${doing} loses those changes.` : '',
      busy ? `${doing} stops ${busy === 1 ? 'it' : 'them'}; the conversations are saved and you can continue them later.` : ''
    ]
      .filter(Boolean)
      .join(' ')
  }
}

/**
 * Tells you about a finished chat, or one that needs an answer, while you're in another window: a
 * Windows notification and/or a sound Loom plays itself. `test` sends both now, even in front.
 */
function notify(title: string, body: string, test = false): void {
  if (!win || (!test && BrowserWindow.getFocusedWindow())) return
  const sound = settings().notifySound
  if (sound && sound !== 'off' && !win.webContents.isDestroyed()) win.webContents.send('app:notifySound', sound)
  if ((!settings().notifyWhenDone && !test) || !Notification.isSupported()) return
  // The sound, when there is one, is Loom's own: Windows stays quiet then.
  const n = new Notification({ title, body, silent: !!sound && sound !== 'off' })
  n.on('click', () => {
    win?.show()
    win?.focus()
  })
  n.show()
}

/** Whether Windows itself has notifications switched off, for all apps or for Loom. */
function windowsNotificationsOff(): Promise<boolean> {
  const query = (key: string, value: string): Promise<string> =>
    new Promise((resolve) => execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (_e, out) => resolve(String(out ?? ''))))
  return Promise.all([
    query('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled'),
    query(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${APP_ID}`, 'Enabled')
  ]).then(([all, mine]) => /ToastEnabled\s+REG_DWORD\s+0x0\b/i.test(all) || /Enabled\s+REG_DWORD\s+0x0\b/i.test(mine))
}

// The model menu follows the account: each plan limits reading also asks which models it has, so
// a list saved while signed out (only the basic five) or under another account is replaced.
const usageDeps = {
  sdk: loadSdk,
  liveQuery,
  executable: executableFor,
  settings,
  onModels: (models: Parameters<typeof modelOptions>[0]) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('models:update', modelOptions(models))
  }
}
function accountChanged(): void {
  releaseIdleChats()
  forgetUsage(win?.webContents ?? null)
  usageNow(true)
}

function usageNow(force = false): void {
  void refreshUsage(win?.webContents ?? null, usageDeps, force)
}

function registerIpc(): void {
  ipcMain.on('app:unsaved', (e, names: string[]) => {
    const id = e.sender.id
    if (!unsavedByWindow.has(id)) e.sender.once('destroyed', () => unsavedByWindow.delete(id))
    if (names.length) unsavedByWindow.set(id, names)
    else unsavedByWindow.set(id, [])
  })
  ipcMain.handle('state:load', () => state)
  ipcMain.on('state:save', (_e, next: PersistedState) => {
    const keep = state.settings.keepChatBackupsDays
    state = next
    saveState(next)
    // Kept for less time than before: the copies past it go now, not tomorrow.
    if (next.settings.keepChatBackupsDays !== keep) pruneBackups()
  })

  ipcMain.handle('app:pickFolder', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Add a project folder' })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('app:pickFile', async (_e, title: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('app:claudeInfo', () => claudeInfo())
  ipcMain.handle('claude:auth', () => claudeAuthStatus(settings()))
  ipcMain.handle('claude:logout', async () => {
    const r = await claudeLogout(settings())
    if (r.ok) accountChanged()
    return r
  })
  // Signed in as someone else: chats and limits follow.
  ipcMain.on('claude:accountChanged', () => accountChanged())
  ipcMain.handle('login:start', () => startLogin(claudeProgram(settings()), accountChanged))
  ipcMain.handle('login:state', () => loginState())
  ipcMain.on('login:code', (_e, code: string) => submitLoginCode(code))
  ipcMain.on('login:cancel', () => cancelLogin())
  ipcMain.handle('claude:program', () => claudeProgram(settings()))
  ipcMain.handle('fs:dirsExist', (_e, paths: string[]) => dirsExist(paths))
  ipcMain.handle('fs:subfolders', (_e, dir: string) => listSubfolders(dir))
  ipcMain.handle('app:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('app:notifyOff', () => windowsNotificationsOff())
  ipcMain.on('app:notifyTest', () => notify('Loom', 'This is how Loom tells you a chat is done.', true))
  ipcMain.on('app:notifySettings', () => void shell.openExternal('ms-settings:notifications'))
  // An image from a chat onto the clipboard, as an image other apps can paste.
  ipcMain.handle('app:copyImage', async (_e, dataUrl: string) => {
    const image = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? nativeImage.createFromDataURL(dataUrl) : null
    if (!image || image.isEmpty()) return false
    // Always as PNG, whatever it was sent as: the format every app can paste.
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  })
  ipcMain.handle('fs:create', (_e, path: string, kind: 'file' | 'folder') => createEntry(path, kind))
  ipcMain.handle('fs:rename', (_e, from: string, to: string) => renameEntry(from, to))
  ipcMain.handle('fs:trash', async (_e, path: string) => {
    try {
      await shell.trashItem(path)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('app:openPath', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // Claude
  ipcMain.handle('sessions:list', (_e, force?: boolean) => listAllSessions(force))
  ipcMain.handle('sessions:history', async (_e, sessionId: string) => {
    const history = await loadHistory(sessionId)
    // Thumbnails beyond the first few are made here, a turn of the event loop between images.
    await finishThumbnails(history.items)
    return history
  })
  ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => renameSession(sessionId, title))
  ipcMain.handle('sessions:move', (_e, sessionId: string, fromCwd: string, toCwd: string) => moveSession(sessionId, fromCwd, toCwd))

  ipcMain.handle('chat:open', (e, tabId: string, opts: ChatStartOptions) => {
    openChat(e.sender, tabId, opts, settings, (id, error, ask) => {
      const tab = state.tabs.find((t) => t.id === id)
      if (ask) return notify('Claude needs you', tab ? `${tab.title}: ${ask}` : ask)
      notify(error ? 'Claude stopped with an error' : 'Claude finished', tab?.title ?? 'A chat finished')
      setTimeout(() => usageNow(true), 1500)
    })
  })
  ipcMain.handle('chat:send', (_e, tabId: string, text: string, images: ImageAttachment[], id?: string) => getChat(tabId)?.send(text, images, id))
  ipcMain.handle('chat:interrupt', (_e, tabId: string) => getChat(tabId)?.interrupt())
  ipcMain.handle('chat:stopTask', (_e, tabId: string, taskId: string) => getChat(tabId)?.stopTask(taskId))
  ipcMain.handle('chat:setModel', (_e, tabId: string, model: string | null) => getChat(tabId)?.setModel(model))
  ipcMain.handle('chat:setEffort', (_e, tabId: string, effort: EffortLevel | null, ultracode: boolean) =>
    getChat(tabId)?.setEffort(effort, ultracode)
  )
  ipcMain.handle('chat:setMode', (_e, tabId: string, mode: PermissionMode) => getChat(tabId)?.setPermissionMode(mode))
  ipcMain.handle('chat:respond', (_e, tabId: string, requestId: string, response: PermissionResponse) =>
    getChat(tabId)?.respond(requestId, response)
  )
  ipcMain.handle('chat:close', (_e, tabId: string) => closeChat(tabId))
  ipcMain.handle('commands:list', (_e, cwd: string) => commandsFor(cwd, settings()))

  // Files and git
  ipcMain.handle('fs:listDir', (_e, dir: string) => listDir(dir))
  ipcMain.handle('fs:read', (_e, path: string) => readTextFile(path))
  ipcMain.handle('fs:write', (_e, path: string, content: string, opts?: FileWriteOptions) => writeTextFile(path, content, opts))
  ipcMain.handle('fs:mtime', (_e, path: string) => fileMtime(path))
  ipcMain.handle('fs:projectFiles', (_e, root: string) => listProjectFiles(root))
  ipcMain.handle('fs:configFiles', (_e, projectPath: string | null) => configFiles(projectPath))
  ipcMain.handle('git:status', (_e, dir: string) => gitStatus(dir))
  ipcMain.handle('git:changes', (_e, dir: string) => gitChanges(dir))
  ipcMain.handle('git:diff', (_e, dir: string, abs: string, commit: string | null) => gitDiff(dir, abs, commit))
  ipcMain.handle('git:stage', (_e, dir: string, abs: string[]) => gitStage(dir, abs))
  ipcMain.handle('git:unstage', (_e, dir: string, abs: string[]) => gitUnstage(dir, abs))
  ipcMain.handle('git:discard', (_e, dir: string, files: { abs: string; untracked: boolean; added: boolean }[]) => gitDiscard(dir, files))
  ipcMain.handle('git:commit', (_e, dir: string, message: string, stageAll: boolean, only?: string[]) => gitCommit(dir, message, stageAll, only))
  ipcMain.handle('git:push', (_e, dir: string) => gitPush(dir))
  ipcMain.handle('git:pull', (_e, dir: string) => gitPull(dir))
  ipcMain.handle('git:branches', (_e, dir: string) => gitBranches(dir))
  ipcMain.handle('git:switch', (_e, dir: string, branch: string, create: boolean) => gitSwitch(dir, branch, create))
  ipcMain.handle('git:log', (_e, dir: string) => gitLog(dir))
  ipcMain.handle('git:commitFiles', (_e, dir: string, hash: string) => gitCommitFiles(dir, hash))
  ipcMain.handle('git:writeMessage', async (_e, dir: string, only?: string[]) => {
    const d = await diffForMessage(dir, only)
    if (!d) return { error: 'This folder is not in a git repository.' }
    if (!d.files.trim()) return { error: 'There is nothing to commit.' }
    return writeCommitMessage(dir, d.files, d.text, settings())
  })
  ipcMain.handle('project:icon', async (_e, root: string, mode: string, customPath: string | null, others: string[]) => {
    if (mode === 'none') return null
    const path = mode === 'custom' && customPath ? customPath : await detectProjectIcon(root, others)
    return path ? iconDataUrl(path) : null
  })
  ipcMain.handle('icon:read', (_e, path: string) => iconDataUrl(path))
  ipcMain.handle('image:full', (_e, ref: string) => fullImage(ref))
  ipcMain.handle('project:pickIcon', async (_e, title?: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: title || 'Choose an icon for this project',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['svg', 'png', 'ico', 'webp', 'jpg', 'jpeg', 'gif'] }]
    })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  // Plan limits
  ipcMain.handle('usage:get', (_e, force?: boolean) => (force ? refreshUsage(win?.webContents ?? null, usageDeps, true) : lastUsage() ?? refreshUsage(win?.webContents ?? null, usageDeps)))

  // Terminals
  ipcMain.handle('pty:create', (e, id: string, cwd: string, cols: number, rows: number) =>
    createTerminal(e.sender, id, cwd, cols, rows, settings().shell)
  )
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  ipcMain.handle('pty:kill', (_e, id: string) => killTerminal(id))

  // Dev servers
  ipcMain.handle('run:detect', (_e, root: string, others: string[]) => detectRunTargets(root, others))
  ipcMain.handle('server:list', () => listServers())
  ipcMain.handle('server:start', (_e, projectId: string, target: RunTarget, install?: boolean) => startServer(projectId, target, !!install))
  ipcMain.handle('server:missingPackages', (_e, target: RunTarget) => missingPackages(target))
  ipcMain.handle('server:stop', (_e, id: string) => stopServer(id))
  ipcMain.handle('server:restart', (_e, id: string, install?: boolean) => restartServer(id, !!install))
  ipcMain.handle('server:dismiss', (_e, id: string) => dismissServer(id))
  ipcMain.handle('server:log', (_e, id: string) => serverLog(id))
  ipcMain.on('server:write', (_e, id: string, data: string) => writeServer(id, data))
}

// Named apart from the installed app's "Loom" shortcut, for people who have both.
const SHORTCUT = 'Loom (source).lnk'

/**
 * Keeps a Start menu shortcut pointing at this copy of Loom (and adds a desktop one the first
 * time). Only for copies built from source: the installer makes and removes its own.
 */
function ensureShortcuts(): void {
  if (process.platform !== 'win32' || isDev || app.isPackaged || process.env.LOOM_USER_DATA) return
  try {
    const root = app.getAppPath()
    const opts = {
      target: process.execPath,
      args: `"${root}"`,
      cwd: root,
      icon: join(root, 'resources', 'icon.ico'),
      iconIndex: 0,
      appUserModelId: APP_ID,
      description: 'Loom: all your projects and Claude chats in one window'
    }
    const startMenu = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT)
    shell.writeShortcutLink(startMenu, existsSync(startMenu) ? 'replace' : 'create', opts)
    const flag = join(app.getPath('userData'), 'shortcuts.json')
    if (!existsSync(flag)) {
      shell.writeShortcutLink(join(app.getPath('desktop'), SHORTCUT), 'create', opts)
      writeFileSync(flag, JSON.stringify({ desktopCreated: new Date().toISOString() }))
    }
  } catch (e) {
    console.error('[shortcuts]', e)
  }
}

app.whenReady().then(() => {
  if (!primary) return
  ensureShortcuts()
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'"
          ]
        }
      })
    })
  }
  installMenu()
  registerIpc()
  lockDownPreviews()
  setupPopouts({ main: () => win, quitting: () => quitting, options: windowOptions, load: loadRenderer, guard: guardNavigation })
  createWindow()
  setupRemote({ main: () => win })
  setupUpdates({ confirm: () => confirmLoss('Restarting', 'Restart now', 'Later') })
  // Plan limits: shortly after start, then every five minutes while a Loom window has focus. With
  // no chat running, each reading starts a Claude Code process, so a Loom left in the background
  // doesn't poll; it also reads them after every reply and when asked.
  // The meter shows the last saved reading at once; a fresh one follows shortly after start.
  setTimeout(() => usageNow(true), 1500)
  // Old copies of moved chats: a while after starting, then once a day.
  setTimeout(pruneBackups, 30_000)
  setInterval(pruneBackups, 24 * 60 * 60_000)
  setInterval(() => {
    if (BrowserWindow.getFocusedWindow()) usageNow(false)
  }, 5 * 60_000)
})

function pruneBackups(): void {
  pruneChatBackups(settings().keepChatBackupsDays ?? 30)
    .then((n) => n && console.log(`[backups] deleted ${n} old copies of moved chats`))
    .catch((e) => console.error('[backups]', e))
}

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  // State and the window's place are saved before anything that could stall or throw. Whatever
  // happens after that, Loom quits: a Loom.exe left running with no window holds the
  // single-instance lock, and every later launch would exit at once.
  void (async () => {
    try {
      await Promise.all([flushState(), flushBounds()])
      closeAllChats()
      killAllTerminals()
      killAllServers()
      cancelLogin()
      closeRemote()
    } catch (err) {
      console.error('[quit]', err)
    } finally {
      app.quit()
    }
  })()
})

app.on('window-all-closed', () => app.quit())
