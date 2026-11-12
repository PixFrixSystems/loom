import { app, screen } from 'electron'
import { copyFileSync, promises as fs, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MODELS, DEFAULT_SETTINGS, type PersistedState } from '@shared/types'

const FILE = 'loom-state.json'
const BACKUP = 'loom-state.bak.json'

function statePath(): string {
  return join(app.getPath('userData'), FILE)
}

/**
 * Writes a temporary file, makes sure it is on disk, then renames it over the real one: a crash
 * or power cut leaves the old version or the new one, never half of one. With `backup`, the
 * version being replaced is kept under that name.
 */
async function writeAtomic(target: string, text: string, backup?: string): Promise<void> {
  const tmp = `${target}.tmp`
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(text, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  if (backup) await keepPrevious(target, backup)
  await fs.rename(tmp, target)
}

/**
 * Keeps the file about to be replaced as a backup. A hard link, so it costs no extra writing on
 * every save; a copy on a drive without hard links. Never in the way of the save itself.
 */
async function keepPrevious(file: string, backup: string): Promise<void> {
  const tmp = `${backup}.tmp`
  try {
    await fs.rm(tmp, { force: true })
    try {
      await fs.link(file, tmp)
    } catch (e) {
      // Nothing saved yet: the backup there (if any) stays.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      await fs.copyFile(file, tmp)
    }
    await fs.rename(tmp, backup)
  } catch (e) {
    console.error('[state] could not keep a backup', e)
  }
}

export function emptyState(): PersistedState {
  return {
    version: 1,
    projects: [],
    groups: [],
    tabs: [],
    activeTabId: null,
    settings: { ...DEFAULT_SETTINGS },
    sidebarWidth: 260,
    sidebarOpen: true,
    rightPanelOpen: false,
    rightPanelWidth: 280,
    rightPanelView: 'files',
    knownModels: DEFAULT_MODELS
  }
}

function parseState(text: string): PersistedState {
  const raw = JSON.parse(text) as Partial<PersistedState> | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a Loom state object')
  const base = emptyState()
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    knownModels: raw.knownModels?.length ? raw.knownModels : base.knownModels
  }
}

export function loadState(): PersistedState {
  const file = statePath()
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    // No file yet is a first run. Any other failure is not, and must not be treated like one.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState()
    return recover(file, e)
  }
  try {
    return parseState(text)
  } catch (e) {
    return recover(file, e)
  }
}

/**
 * The state file is there but unusable. Starting empty would let the first save overwrite it and
 * lose every project, group and tab, so it is moved aside first, then the backup is tried.
 */
function recover(file: string, why: unknown): PersistedState {
  const aside = join(app.getPath('userData'), `loom-state.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  let kept = true
  try {
    renameSync(file, aside)
  } catch {
    try {
      copyFileSync(file, aside)
    } catch {
      kept = false
    }
  }
  console.error(`[state] ${file} could not be read (${(why as Error).message}).`, kept ? `Moved it to ${aside}.` : 'Could not move it aside either.')
  const backup = join(app.getPath('userData'), BACKUP)
  try {
    const state = parseState(readFileSync(backup, 'utf8'))
    console.error(`[state] Loaded ${backup} instead.`)
    return state
  } catch (e) {
    console.error(`[state] No usable backup either (${(e as Error).message}). Starting with an empty state.`)
    return emptyState()
  }
}

let pending: PersistedState | null = null
let timer: NodeJS.Timeout | null = null
let writing: Promise<void> = Promise.resolve()

function writeNow(state: PersistedState): Promise<void> {
  return writeAtomic(statePath(), JSON.stringify(state, null, 2), join(app.getPath('userData'), BACKUP))
}

export function saveState(state: PersistedState): void {
  pending = state
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushState, 300)
}

export function flushState(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const next = pending
  pending = null
  if (next) writing = writing.then(() => writeNow(next)).catch((e) => console.error('[state] save failed', e))
  return writing
}

// Window bounds live in their own small file so a broken state file never loses them.
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function boundsPath(): string {
  return join(app.getPath('userData'), 'window.json')
}

/** Enough of the window's title bar is on some screen to grab it and move the window. */
function reachable(x: number, y: number, width: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const across = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    const down = Math.min(y + 38, a.y + a.height) - Math.max(y, a.y)
    return across >= 160 && down >= 20
  })
}

export function loadBounds(): WindowBounds {
  let b: WindowBounds
  try {
    b = JSON.parse(readFileSync(boundsPath(), 'utf8')) as WindowBounds
  } catch {
    return { width: 1440, height: 920, maximized: false }
  }
  if (typeof b.x !== 'number' || typeof b.y !== 'number' || reachable(b.x, b.y, b.width)) return b
  // Saved on a screen that is gone (a second monitor unplugged, say): without this Loom would open
  // out of sight with only a taskbar button. Centred on the main screen instead, and no bigger.
  const area = screen.getPrimaryDisplay().workArea
  return { width: Math.min(b.width, area.width), height: Math.min(b.height, area.height), maximized: b.maximized }
}

let boundsPending: WindowBounds | null = null
let boundsTimer: NodeJS.Timeout | null = null
let boundsWriting: Promise<void> = Promise.resolve()

/** Moving or resizing reports many times a second; the file is written once the window settles. */
export function saveBounds(bounds: WindowBounds): void {
  boundsPending = bounds
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(flushBounds, 400)
}

export function flushBounds(): Promise<void> {
  if (boundsTimer) {
    clearTimeout(boundsTimer)
    boundsTimer = null
  }
  const next = boundsPending
  boundsPending = null
  if (next) {
    boundsWriting = boundsWriting
      .then(() => writeAtomic(boundsPath(), JSON.stringify(next)))
      .catch((e) => console.error('[state] bounds save failed', e))
  }
  return boundsWriting
}
