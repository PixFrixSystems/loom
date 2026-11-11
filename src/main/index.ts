import { app, BrowserWindow, dialog, ipcMain, Notification, shell, session, type BrowserWindowConstructorOptions } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupUpdates } from './updates'
import type {
  ChatStartOptions,
  EffortLevel,
  ImageAttachment,
  LoomSettings,
  PermissionMode,
  PermissionResponse,
  PersistedState,
  RunTarget
} from '@shared/types'
import {
  claudeAuthStatus,
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
import { fullImage } from './images'
import { lastUsage, refreshUsage } from './usage'
import { configFiles, dirsExist, fileMtime, gitStatus, listDir, listProjectFiles, listSubfolders, readTextFile, writeTextFile } from './files'
import { createTerminal, killAllTerminals, killTerminal, resizeTerminal, writeTerminal } from './pty'
import {
  detectRunTargets,
  dismissServer,
  killAllServers,
  listServers,
  restartServer,
  serverLog,
  startServer,
  stopServer,
  writeServer
} from './servers'
import { closeAllPopouts, setupPopouts } from './popouts'
import { flushState, loadBounds, loadState, saveBounds, saveState } from './state'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

// Tests point Loom at a scratch folder so they never touch the real state.
if (process.env.LOOM_USER_DATA) app.setPath('userData', process.env.LOOM_USER_DATA)

let win: BrowserWindow | null = null
let state: PersistedState = loadState()
const settings = (): LoomSettings => state.settings

if (!app.requestSingleInstanceLock()) {
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
    backgroundColor: '#1a1c20',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#16181b', symbolColor: '#a8a49b', height: 38 },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Browser tabs show sites in a <webview>, locked down below.
      webviewTag: true
    }
  }
}

const APP_KEYS = ['w', 't', 'p', 'tab', '\\', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Browser tabs: the site runs in its own sandboxed page with no access to Loom, links that
 * open new windows go to the real browser, and Loom's shortcuts still work while the page has focus.
 */
function lockDownPreviews(): void {
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

  win.once('ready-to-show', () => win?.show())

  const rememberBounds = (): void => {
    if (!win) return
    const b = win.getNormalBounds()
    void saveBounds({ ...b, maximized: win.isMaximized() })
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)

  win.on('close', (e) => {
    const busy = runningChats()
    if (busy > 0 && win) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Quit anyway', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Loom',
        message: busy === 1 ? 'A chat is still running.' : `${busy} chats are still running.`,
        detail: 'Quitting stops them. Their conversations are saved and you can continue them later.'
      })
      if (choice === 1) e.preventDefault()
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

function notify(title: string, body: string): void {
  if (!settings().notifyWhenDone || !win || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    win?.show()
    win?.focus()
  })
  n.show()
}

const usageDeps = { sdk: loadSdk, liveQuery, executable: executableFor, settings }
function usageNow(force = false): void {
  void refreshUsage(win?.webContents ?? null, usageDeps, force)
}

function registerIpc(): void {
  ipcMain.handle('state:load', () => state)
  ipcMain.on('state:save', (_e, next: PersistedState) => {
    state = next
    saveState(next)
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
  ipcMain.handle('claude:program', () => claudeProgram(settings()))
  ipcMain.handle('fs:dirsExist', (_e, paths: string[]) => dirsExist(paths))
  ipcMain.handle('fs:subfolders', (_e, dir: string) => listSubfolders(dir))
  ipcMain.handle('app:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('app:openPath', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // Claude
  ipcMain.handle('sessions:list', (_e, force?: boolean) => listAllSessions(force))
  ipcMain.handle('sessions:history', (_e, sessionId: string) => loadHistory(sessionId))
  ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => renameSession(sessionId, title))
  ipcMain.handle('sessions:move', (_e, sessionId: string, fromCwd: string, toCwd: string) => moveSession(sessionId, fromCwd, toCwd))

  ipcMain.handle('chat:open', (e, tabId: string, opts: ChatStartOptions) => {
    openChat(e.sender, tabId, opts, settings, (id, error) => {
      const tab = state.tabs.find((t) => t.id === id)
      notify(error ? 'Claude stopped with an error' : 'Claude finished', tab?.title ?? 'A chat finished')
      setTimeout(() => usageNow(true), 1500)
    })
  })
  ipcMain.handle('chat:send', (_e, tabId: string, text: string, images: ImageAttachment[]) => getChat(tabId)?.send(text, images))
  ipcMain.handle('chat:interrupt', (_e, tabId: string) => getChat(tabId)?.interrupt())
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
  ipcMain.handle('fs:write', (_e, path: string, content: string) => writeTextFile(path, content))
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
  ipcMain.handle('server:start', (_e, projectId: string, target: RunTarget) => startServer(projectId, target))
  ipcMain.handle('server:stop', (_e, id: string) => stopServer(id))
  ipcMain.handle('server:restart', (_e, id: string) => restartServer(id))
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
  registerIpc()
  lockDownPreviews()
  setupPopouts({ main: () => win, quitting: () => quitting, options: windowOptions, load: loadRenderer, guard: guardNavigation })
  createWindow()
  setupUpdates()
  // Plan limits: shortly after start, then every five minutes while Loom is open.
  setTimeout(() => usageNow(true), 4000)
  setInterval(() => usageNow(false), 5 * 60_000)
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  closeAllChats()
  killAllTerminals()
  killAllServers()
  void flushState().finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
