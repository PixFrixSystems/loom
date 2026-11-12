import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { fileLogger } from './logfile'

// The installed app finds new versions on GitHub Releases shortly after it starts and every few
// hours, downloads them in the background, and then shows a Restart to update button, the way
// VS Code does. Ignored, the update still installs the next time Loom quits.

let status: UpdateStatus = { enabled: false, version: app.getVersion(), state: 'idle' }
let updater: AppUpdater | null = null
let installing = false

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('update:status', status)
}

/** The releases page of the repository this copy was built from, for "What's new". */
function releasesUrl(): string | null {
  try {
    const yml = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /^owner:\s*(.+)$/m.exec(yml)?.[1]?.trim()
    const repo = /^repo:\s*(.+)$/m.exec(yml)?.[1]?.trim()
    return owner && repo ? `https://github.com/${owner}/${repo}/releases` : null
  } catch {
    return null
  }
}

function failed(e: unknown): void {
  const text = e instanceof Error ? e.message : String(e)
  // Nothing released yet counts as being up to date, and so does a release whose files are still
  // uploading (GitHub lists a new version's tag a few minutes before its latest.yml is there).
  if (/no published versions|cannot find latest\.yml/i.test(text)) return set({ state: 'none', checkedAt: Date.now(), error: undefined })
  const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|net::ERR_/i.test(text)
  set({ state: 'error', error: offline ? "Couldn't reach GitHub. Check the connection and try again." : text.split('\n')[0].slice(0, 200) })
}

async function check(): Promise<UpdateStatus> {
  if (!updater || status.state === 'downloading' || status.state === 'ready') return status
  try {
    await updater.checkForUpdates()
  } catch (e) {
    failed(e)
  }
  return status
}

interface InstallDeps {
  busyChats: () => number
  /** Files with unsaved edits in any Loom window */
  unsaved: () => string[]
  explain: (busy: number, unsaved: string[], doing: string) => { message: string; detail: string }
  window: () => BrowserWindow | null
}

async function install(opts: InstallDeps): Promise<boolean> {
  if (!updater || status.state !== 'ready') return false
  const busy = opts.busyChats()
  const unsaved = opts.unsaved()
  const win = opts.window()
  if ((busy > 0 || unsaved.length) && win) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Restart now', 'Later'],
      defaultId: unsaved.length ? 1 : 0,
      cancelId: 1,
      title: 'Loom',
      ...opts.explain(busy, unsaved, 'Restarting')
    })
    if (response !== 0) return false
  }
  installing = true
  // The install runs silently with no window open, and unpacking can take half a minute; this says
  // what's going on.
  if (Notification.isSupported()) {
    new Notification({
      title: `Updating Loom to ${status.available}`,
      body: 'Loom closes, installs the update and opens again by itself when it is done. That can take up to a minute.',
      silent: true
    }).show()
  }
  // Silent install, then Loom opens again by itself.
  updater.quitAndInstall(true, true)
  return true
}

/** True while Loom is closing to install an update, so closing doesn't ask about running chats again. */
export function installingUpdate(): boolean {
  return installing
}

export function setupUpdates(opts: InstallDeps): void {
  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:install', () => install(opts))
  ipcMain.handle('update:notes', () => {
    const url = releasesUrl()
    if (url) void shell.openExternal(status.available ? `${url}/tag/v${status.available}` : url)
  })

  // Copies built from source update with git. Scratch profiles (tests) leave updates alone unless asked.
  if (!app.isPackaged || (process.env.LOOM_USER_DATA && !process.env.LOOM_UPDATES)) return
  status = { ...status, enabled: true }
  import('electron-updater')
    .then((mod) => {
      const u = mod.autoUpdater ?? (mod as unknown as { default: typeof mod }).default.autoUpdater
      updater = u
      // The updater's own account of what it did, so a failed "Restart to update" leaves a trace.
      u.logger = fileLogger(join(app.getPath('userData'), 'logs', 'updates.log'))
      u.autoDownload = true
      u.autoInstallOnAppQuit = true
      u.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
      u.on('update-available', (info) => set({ state: 'downloading', available: info.version, percent: 0 }))
      u.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
      u.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
      u.on('update-downloaded', (info) => set({ state: 'ready', available: info.version, checkedAt: Date.now() }))
      u.on('error', failed)
      setTimeout(() => void check(), 15_000)
      setInterval(() => void check(), 4 * 60 * 60_000)
    })
    .catch(() => set({ enabled: false }))
}
