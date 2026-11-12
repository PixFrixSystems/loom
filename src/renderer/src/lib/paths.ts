import type { Project } from '@shared/types'

export function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function isInside(child: string, parent: string): boolean {
  const c = normPath(child)
  const p = normPath(parent)
  return c === p || c.startsWith(`${p}\\`)
}

/** The most specific project that contains a path. */
export function projectForPath(projects: Project[], path: string): Project | null {
  let best: Project | null = null
  for (const p of projects) {
    if (isInside(path, p.path) && (!best || normPath(p.path).length > normPath(best.path).length)) best = p
  }
  return best
}

export function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** The folder a path is in. */
export function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return i > 0 ? trimmed.slice(0, i) : trimmed
}

export function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${rel.replace(/^[\\/]+/, '').replace(/\//g, '\\')}`
}

export function relPath(full: string, root: string): string {
  if (!isInside(full, root)) return full
  return full.slice(root.replace(/[\\/]+$/, '').length + 1)
}

export function shortPath(p: string, home?: string): string {
  if (home && isInside(p, home)) return `~${p.slice(home.replace(/[\\/]+$/, '').length)}`
  return p
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** 4 s, 1m 12s, 2h 5m: how long something took. */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** A small copy of an image for showing in the chat, so big screenshots aren't decoded at full size. */
export async function thumbnailOf(dataUrl: string, side = 400): Promise<string | null> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
    if (scale === 1) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.85)
  } catch {
    return null
  }
}

export function uid(): string {
  return crypto.randomUUID()
}

const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown', css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml', py: 'python', php: 'php',
  sh: 'shell', bash: 'shell', ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat', sql: 'sql',
  rs: 'rust', go: 'go', java: 'java', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', rb: 'ruby',
  toml: 'ini', ini: 'ini', env: 'ini', conf: 'ini', properties: 'ini', dockerfile: 'dockerfile', graphql: 'graphql',
  vue: 'html', svelte: 'html', txt: 'plaintext', log: 'plaintext'
}

export function languageFor(path: string): string {
  const name = baseName(path).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name.startsWith('.env')) return 'ini'
  if (name === '.gitignore' || name === '.npmrc') return 'ini'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return LANGS[ext] ?? 'plaintext'
}
