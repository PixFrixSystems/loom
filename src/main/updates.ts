import { app } from 'electron'

/**
 * The installed app looks for a newer Loom on GitHub Releases shortly after it starts and every
 * few hours, downloads it in the background and installs it the next time Loom quits. Copies
 * built from source update with git instead, so they skip this.
 */
export function setupUpdates(): void {
  if (!app.isPackaged || process.env.LOOM_USER_DATA) return
  import('electron-updater')
    .then((mod) => {
      const updater = mod.autoUpdater ?? (mod as unknown as { default: typeof mod }).default.autoUpdater
      updater.logger = null
      const check = (): void => {
        updater.checkForUpdatesAndNotify().catch(() => undefined)
      }
      setTimeout(check, 15_000)
      setInterval(check, 6 * 60 * 60_000)
    })
    .catch(() => undefined)
}
