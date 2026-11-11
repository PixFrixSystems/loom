import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, parse } from 'node:path'

const MAX_ICON_BYTES = 768 * 1024

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
}

// Where sites usually keep their icon, most likely first.
const DIRS = ['app', 'src/app', 'public', '', 'static', 'src/assets', 'assets', 'brand', 'resources', 'public/images', 'public/img']
// Crisp vector first, then large PNGs, then .ico.
const NAMES = [
  'icon.svg',
  'favicon.svg',
  'icon.png',
  'favicon.png',
  'apple-icon.png',
  'apple-touch-icon.png',
  'favicon.ico',
  'icon.ico'
]

async function isFile(p: string): Promise<number | null> {
  try {
    const st = await fs.stat(p)
    return st.isFile() ? st.size : null
  } catch {
    return null
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function findIn(root: string): Promise<string | null> {
  for (const dir of DIRS) {
    const base = dir ? join(root, dir) : root
    let names: string[]
    try {
      names = (await fs.readdir(base)).map((n) => n.toLowerCase())
    } catch {
      continue
    }
    for (const name of NAMES) {
      if (names.includes(name)) {
        const p = join(base, name)
        const size = await isFile(p)
        if (size && size <= MAX_ICON_BYTES) return p
      }
    }
    // Sized favicons such as favicon-192.png: take the largest PNG.
    const sized = names
      .filter((n) => /^favicon-\d+.*\.png$/.test(n))
      .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))
    for (const n of sized) {
      const p = join(base, n)
      const size = await isFile(p)
      if (size && size <= MAX_ICON_BYTES) return p
    }
  }
  return null
}

/**
 * The icon file a project most likely uses. When the folder itself is not an app
 * (no package.json) it also looks one folder down, e.g. shop\web.
 */
export async function detectProjectIcon(root: string, otherProjects: string[]): Promise<string | null> {
  const direct = await findIn(root)
  if (direct) return direct
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  if (norm(root) === norm(homedir()) || parse(root).root.toLowerCase() === `${norm(root)}\\`) return null

  // The usual places a repo keeps its website.
  for (const sub of ['web', 'apps/web', 'site', 'website', 'frontend', 'client', 'www']) {
    const found = (await exists(join(root, sub))) ? await findIn(join(root, sub)) : null
    if (found) return found
  }

  // A folder wrapping one to three apps (e.g. shop\web). A folder of many apps is a
  // collection, not a project with one face, so it keeps its colour thread.
  const others = new Set(otherProjects.map(norm))
  let apps: string[] = []
  try {
    const subs = (await fs.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_') && !['node_modules', 'dist', 'build', 'out'].includes(d.name))
      .map((d) => join(root, d.name))
      .filter((p) => !others.has(norm(p)))
    for (const sub of subs) if (await exists(join(sub, 'package.json'))) apps.push(sub)
  } catch {
    return null
  }
  if (apps.length === 0 || apps.length > 3) return null
  const name = norm(parse(root).name)
  apps = apps.sort((a, b) => Number(norm(b).includes(name)) - Number(norm(a).includes(name)))
  for (const sub of apps) {
    const found = await findIn(sub)
    if (found) return found
  }
  return null
}

/** Reads an icon as a data URL the window can show. */
export async function iconDataUrl(path: string): Promise<string | null> {
  const mime = MIME[extname(path).toLowerCase()]
  if (!mime) return null
  const size = await isFile(path)
  if (!size || size > MAX_ICON_BYTES) return null
  try {
    const buf = await fs.readFile(path)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
