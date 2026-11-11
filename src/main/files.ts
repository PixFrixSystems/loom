import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import type { ConfigFileInfo, DirEntry, FileReadResult, GitStatus } from '@shared/types'

const MAX_EDITABLE_BYTES = 8 * 1024 * 1024

const HIDDEN_DIRS = new Set(['.git'])
const WALK_SKIP = new Set(['.git', 'node_modules', '.next', 'out', 'dist', 'build', '.turbo', '.cache', '.vercel', 'coverage'])

export async function listDir(dir: string): Promise<DirEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !(e.isDirectory() && HIDDEN_DIRS.has(e.name)))
    .map((e) => ({ name: e.name, path: join(dir, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.isDir ? -1 : 1))
}

export async function readTextFile(path: string): Promise<FileReadResult> {
  try {
    const st = await fs.stat(path)
    if (st.size > MAX_EDITABLE_BYTES) return { ok: false, reason: 'too-large', size: st.size }
    const buf = await fs.readFile(path)
    const head = buf.subarray(0, Math.min(buf.length, 8000))
    if (head.includes(0)) return { ok: false, reason: 'binary', size: st.size }
    let content = buf.toString('utf8')
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
    const eol = content.includes('\r\n') ? 'crlf' : 'lf'
    return { ok: true, content, mtime: st.mtimeMs, eol }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'error', message: err.message }
  }
}

export async function writeTextFile(path: string, content: string): Promise<number> {
  await fs.writeFile(path, content, 'utf8')
  return (await fs.stat(path)).mtimeMs
}

export async function fileMtime(path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).mtimeMs
  } catch {
    return null
  }
}

// Loom checks git in the background for every project; with optional locks off those checks never
// hold a lock that could make a commit by you or Claude fail at the same moment.
const RUN_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' } as Record<string, string>
delete RUN_ENV.ELECTRON_RUN_AS_NODE

function run(cmd: string, args: string[], cwd: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: RUN_ENV }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** Files under a project for quick open. Uses git when the folder is in a repo, so .gitignore is respected. */
export async function listProjectFiles(root: string): Promise<string[]> {
  try {
    const out = await run('git', ['-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard', '--', '.'], root, 15000)
    const files = out.split('\n').filter(Boolean)
    if (files.length) return files.slice(0, 60000).map((f) => f.replace(/\//g, '\\'))
  } catch {
    // not a git folder: walk it
  }
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    if (found.length >= 30000) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (found.length >= 30000) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) await walk(full)
      } else found.push(relative(root, full))
    }
  }
  await walk(root)
  return found
}

const remotes = new Map<string, { at: number; url: string | null }>()

/** The repository's remote: origin when there is one, else the first. Cached; remotes rarely change. */
async function remoteOf(dir: string): Promise<string | null> {
  const key = dir.toLowerCase()
  const hit = remotes.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.url
  let url: string | null = null
  try {
    const lines = (await run('git', ['config', '--get-regexp', '^remote\\..*\\.url$'], dir, 5000)).split('\n').filter(Boolean)
    const pick = lines.find((l) => l.startsWith('remote.origin.url ')) ?? lines[0]
    url = pick ? pick.slice(pick.indexOf(' ') + 1).trim() : null
  } catch {
    // no remotes: git exits with 1
  }
  remotes.set(key, { at: Date.now(), url })
  return url
}

export async function gitStatus(dir: string): Promise<GitStatus | null> {
  try {
    const out = await run('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b', '--', '.'], dir, 8000)
    const lines = out.split('\n').filter(Boolean)
    const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
    let branch: string | null = null
    let ahead = 0
    let behind = 0
    if (head) {
      let h = head.replace(/^No commits yet on /, '')
      const extra = h.match(/\[(.*)\]$/)?.[1] ?? ''
      h = h.replace(/\s*\[.*\]$/, '')
      branch = h.split('...')[0].trim() || null
      if (branch?.startsWith('HEAD')) branch = 'detached'
      ahead = Number(extra.match(/ahead (\d+)/)?.[1] ?? 0)
      behind = Number(extra.match(/behind (\d+)/)?.[1] ?? 0)
    }
    return { branch, changes: lines.length, ahead, behind, remote: await remoteOf(dir) }
  } catch {
    return null
  }
}

export async function configFiles(projectPath: string | null): Promise<ConfigFileInfo[]> {
  const claudeDir = join(homedir(), '.claude')
  const list: Omit<ConfigFileInfo, 'exists'>[] = [
    { label: 'Settings', path: join(claudeDir, 'settings.json'), scope: 'global' },
    { label: 'Local settings', path: join(claudeDir, 'settings.local.json'), scope: 'global' },
    { label: 'CLAUDE.md', path: join(claudeDir, 'CLAUDE.md'), scope: 'global' },
    { label: 'Keybindings', path: join(claudeDir, 'keybindings.json'), scope: 'global' }
  ]
  if (projectPath) {
    list.push(
      { label: 'CLAUDE.md', path: join(projectPath, 'CLAUDE.md'), scope: 'project' },
      { label: 'AGENTS.md', path: join(projectPath, 'AGENTS.md'), scope: 'project' },
      { label: 'Settings', path: join(projectPath, '.claude', 'settings.json'), scope: 'project' },
      { label: 'Local settings', path: join(projectPath, '.claude', 'settings.local.json'), scope: 'project' },
      { label: 'MCP servers', path: join(projectPath, '.mcp.json'), scope: 'project' }
    )
  }
  return Promise.all(
    list.map(async (f) => ({ ...f, exists: (await fileMtime(f.path)) !== null, label: f.label || basename(f.path) }))
  )
}
