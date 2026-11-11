import { app } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MODELS, DEFAULT_SETTINGS, type PersistedState } from '@shared/types'

const FILE = 'loom-state.json'

function statePath(): string {
  return join(app.getPath('userData'), FILE)
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

async function writeNow(state: PersistedState): Promise<void> {
  const target = statePath()
  const tmp = `${target}.tmp`
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(tmp, target)
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

export function loadBounds(): WindowBounds {
  try {
    return JSON.parse(readFileSync(boundsPath(), 'utf8')) as WindowBounds
  } catch {
    return { width: 1440, height: 920, maximized: false }
  }
}

export async function saveBounds(bounds: WindowBounds): Promise<void> {
  try {
    await fs.writeFile(boundsPath(), JSON.stringify(bounds), 'utf8')
  } catch (e) {
    console.error('[state] bounds save failed', e)
  }
}
