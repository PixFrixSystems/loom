/**
 * Pictures and videos behind areas of the window (Settings, Pictures and decorations). Loom keeps its
 * own copy of each in userData/backgrounds under a random name, so moving or deleting the original
 * changes nothing, and the page only ever names a copy, never a path. The page can't load files
 * itself: it asks for a copy's bytes and shows them as a blob: URL, which its content security policy
 * allows for images and media.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isVideo, PICTURE_FILE, PICTURE_TYPES, type PictureKind } from '@shared/look'

const MAX_PICTURE = 20 * 1024 * 1024
/** A video comes to the page whole, as one blob, so it is kept to a background loop's size */
const MAX_VIDEO = 100 * 1024 * 1024

const folder = (): string => join(app.getPath('userData'), 'backgrounds')

/** What a file really is, by its first bytes, whatever its name says */
function kindOf(head: Buffer): PictureKind | 'quicktime' | null {
  const text = (from: number, to: number): string => head.subarray(from, to).toString('latin1')
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  if (text(0, 4) === 'GIF8') return 'gif'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp'
  // MP4 and QuickTime share a layout: a box of type 'ftyp' first, then the brand
  if (text(4, 8) === 'ftyp') return text(8, 12) === 'qt  ' ? 'quicktime' : 'mp4'
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm'
  return null
}

/** Asks for a picture or video and keeps a copy; null when the dialog is cancelled */
async function pick(win: BrowserWindow | null): Promise<{ file: string } | { error: string } | null> {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a picture or video',
    properties: ['openFile'],
    filters: [{ name: 'Pictures and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }]
  })
  const path = r.canceled ? null : r.filePaths[0]
  if (!path) return null
  try {
    if ((await fs.stat(path)).size > MAX_VIDEO) return { error: 'That file is over 100 MB. Choose a smaller one.' }
    const bytes = await fs.readFile(path)
    const kind = kindOf(bytes.subarray(0, 12))
    if (kind === 'quicktime') return { error: "QuickTime (.mov) videos don't play in Loom. Convert it to MP4 first." }
    if (!kind) return { error: "That file isn't a PNG, JPEG, WebP or GIF picture, or an MP4 or WebM video." }
    if (!isVideo(`x.${kind}`) && bytes.length > MAX_PICTURE) return { error: 'That picture is over 20 MB. Choose a smaller one.' }
    await fs.mkdir(folder(), { recursive: true })
    const file = `${randomBytes(8).toString('hex')}.${kind}`
    await fs.writeFile(join(folder(), file), bytes)
    return { file }
  } catch (e) {
    return { error: `Couldn't copy the file: ${(e as Error).message}` }
  }
}

/** A copy's bytes and type, for the page to show; null for any name that isn't one of Loom's copies */
async function read(file: unknown): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (typeof file !== 'string' || !PICTURE_FILE.test(file)) return null
  try {
    const bytes = await fs.readFile(join(folder(), file))
    return { bytes, type: PICTURE_TYPES[file.slice(file.lastIndexOf('.') + 1) as PictureKind] }
  } catch {
    return null
  }
}

/**
 * Deletes the copies no setting uses any more: pictures removed or replaced. Only at start, so a
 * picture chosen a moment ago is never caught before its setting is saved. Only Loom's own names.
 */
async function prune(inUse: string[]): Promise<void> {
  const names = await fs.readdir(folder()).catch(() => [] as string[])
  const unused = names.filter((n) => PICTURE_FILE.test(n) && !inUse.includes(n))
  await Promise.all(unused.map((n) => fs.unlink(join(folder(), n)).catch(() => undefined)))
}

export function setupPictures(o: { main: () => BrowserWindow | null; inUse: () => string[] }): void {
  ipcMain.handle('look:pick', (e) => pick(BrowserWindow.fromWebContents(e.sender) ?? o.main()))
  ipcMain.handle('look:read', (_e, file: unknown) => read(file))
  // A minimised window doesn't always tell its page through document.hidden, so every window says
  // when it is put away and back, and a background video can pause meanwhile.
  app.on('browser-window-created', (_e, w) => {
    const tell = (shown: boolean) => (): void => {
      if (!w.isDestroyed()) w.webContents.send('look:shown', shown)
    }
    w.on('minimize', tell(false))
    w.on('hide', tell(false))
    w.on('restore', tell(true))
    w.on('show', tell(true))
  })
  void prune(o.inUse())
}
