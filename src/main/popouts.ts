// Tabs moved into windows of their own. The main window keeps the tab in its list; the popout
// shows it. Moving either way is a handoff: the chat's events are held, the giving window hands
// over the tab's live state, then the held events go to the receiving window.

import { BrowserWindow, ipcMain, screen, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import type { Tab, TabSnapshot } from '@shared/types'
import { holdChat, rebindChat } from './claude'

interface Popout {
  win: BrowserWindow
  tab: Tab
  closing: boolean
  handedBack: boolean
}

interface Deps {
  main: () => BrowserWindow | null
  quitting: () => boolean
  options: () => BrowserWindowConstructorOptions
  load: (w: BrowserWindow, query: Record<string, string>) => void
  guard: (w: BrowserWindow) => void
}

const popouts = new Map<string, Popout>()
const waiting = new Map<string, (s: TabSnapshot | null) => void>()

function byWeb(web: WebContents): Popout | undefined {
  return [...popouts.values()].find((p) => !p.win.isDestroyed() && p.win.webContents === web)
}

/** Asks a window for a tab's live state. Gives up after a few seconds rather than hang a move. */
function requestSnapshot(web: WebContents | undefined, tabId: string): Promise<TabSnapshot | null> {
  if (!web || web.isDestroyed()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(tabId)
      resolve(null)
    }, 3000)
    waiting.set(tabId, (s) => {
      clearTimeout(timer)
      waiting.delete(tabId)
      resolve(s)
    })
    web.send('popout:snapshot-request', tabId)
  })
}

export function popoutCount(): number {
  return popouts.size
}

export function setupPopouts(deps: Deps): void {
  const handBack = (tabId: string, snapshot: TabSnapshot | null): void => {
    const p = popouts.get(tabId)
    if (!p || p.handedBack) return
    p.handedBack = true
    const main = deps.main()
    if (main && !main.isDestroyed()) {
      main.webContents.send('popout:returned', tabId, snapshot)
      rebindChat(tabId, main.webContents)
    }
    if (!p.win.isDestroyed()) p.win.destroy()
  }

  ipcMain.on('popout:snapshot', (_e, tabId: string, snapshot: TabSnapshot | null) => waiting.get(tabId)?.(snapshot))

  ipcMain.handle('popout:open', (_e, tab: Tab, at?: { x: number; y: number }) => {
    const open = popouts.get(tab.id)
    if (open && !open.win.isDestroyed()) {
      open.win.focus()
      return
    }
    const main = deps.main()
    const size = { width: 980, height: 740 }
    let pos: { x: number; y: number }
    if (at) {
      // Dropped outside the window: the new one opens under the pointer, title bar first.
      const area = screen.getDisplayNearestPoint(at).workArea
      pos = {
        x: Math.round(Math.min(Math.max(at.x - 160, area.x), area.x + area.width - size.width)),
        y: Math.round(Math.min(Math.max(at.y - 18, area.y), area.y + area.height - size.height))
      }
    } else {
      const b = main?.getBounds() ?? { x: 100, y: 100 }
      pos = { x: b.x + 70, y: b.y + 70 }
    }
    const w = new BrowserWindow({ ...deps.options(), ...pos, ...size, minWidth: 480, minHeight: 360, title: tab.title })
    const p: Popout = { win: w, tab, closing: false, handedBack: false }
    popouts.set(tab.id, p)
    deps.guard(w)
    w.once('ready-to-show', () => w.show())
    w.on('close', (e) => {
      if (p.handedBack || deps.quitting()) return
      // Closing a popout moves its tab back to the main window, with everything it holds.
      e.preventDefault()
      if (p.closing) return
      p.closing = true
      holdChat(tab.id)
      void requestSnapshot(w.webContents, tab.id).then((s) => handBack(tab.id, s))
    })
    w.webContents.on('render-process-gone', () => handBack(tab.id, null))
    w.on('closed', () => {
      if (!p.handedBack) handBack(tab.id, null)
      popouts.delete(tab.id)
    })
    deps.load(w, { popout: tab.id })
  })

  // The popout asks for its tab once it is listening for chat events.
  ipcMain.handle('popout:init', async (e) => {
    const p = byWeb(e.sender)
    if (!p) return null
    holdChat(p.tab.id)
    const snapshot = await requestSnapshot(deps.main()?.webContents, p.tab.id)
    if (snapshot?.tab) p.tab = snapshot.tab
    return { tab: p.tab, snapshot }
  })

  // ...and says when it has taken that state in: only then do the chat's events go to it.
  ipcMain.on('popout:ready', (e) => {
    const p = byWeb(e.sender)
    if (p) rebindChat(p.tab.id, e.sender)
  })

  ipcMain.handle('popout:close', (_e, tabId: string) => popouts.get(tabId)?.win.close())

  ipcMain.handle('popout:discard', (_e, tabId: string) => {
    const p = popouts.get(tabId)
    if (!p) return
    p.handedBack = true
    if (!p.win.isDestroyed()) p.win.destroy()
  })

  ipcMain.handle('popout:focus', (_e, tabId: string) => {
    const p = popouts.get(tabId)
    if (!p || p.win.isDestroyed()) return
    if (p.win.isMinimized()) p.win.restore()
    p.win.focus()
  })

  // Changes to the tab (title, model, the session id of a new chat) reach the main window,
  // which is the one that saves.
  ipcMain.on('popout:tab', (e, tab: Tab) => {
    const p = byWeb(e.sender)
    if (!p) return
    p.tab = tab
    if (!p.win.isDestroyed()) p.win.setTitle(tab.title)
    deps.main()?.webContents.send('popout:tab', tab)
  })

  // Opening a file or a new chat from a popout happens in the main window.
  ipcMain.on('popout:main-do', (_e, action: string, args: unknown[]) => {
    const main = deps.main()
    if (!main || main.isDestroyed()) return
    main.webContents.send('main:do', action, args)
    if (main.isMinimized()) main.restore()
    main.focus()
  })
}

/** When the main window goes, so do the popouts (their tabs are saved with the main window). */
export function closeAllPopouts(): void {
  for (const p of popouts.values()) {
    p.handedBack = true
    if (!p.win.isDestroyed()) p.win.destroy()
  }
}
