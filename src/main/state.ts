import { app, screen } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MODELS, DEFAULT_SETTINGS, type PersistedState } from '@shared/types'

const FILE = 'loom-state.json'

function statePath(): string {
  return join(app.getPath('userData'), FILE)
}

/** Writes a temporary file and renames it over the real one, so a reader never sees half a file. */
async function writeAtomic(target: string, text: string): Promise<void> {
  const tmp = `${target}.tmp`
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, target)
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

export function loadState(): PersistedState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<PersistedState>
    const base = emptyState()
    return {
      ...base,
      ...raw,
      settings: { ...base.settings, ...(raw.settings ?? {}) },
      knownModels: raw.knownModels?.length ? raw.knownModels : base.knownModels
    }
  } catch {
    return emptyState()
  }
}

let pending: PersistedState | null = null
let timer: NodeJS.Timeout | null = null
let writing: Promise<void> = Promise.resolve()

function writeNow(state: PersistedState): Promise<void> {
  return writeAtomic(statePath(), JSON.stringify(state, null, 2))
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
