import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import type { ConfigFileInfo, DirEntry, FileReadResult, FileWriteOptions, FileWriteResult, GitStatus, SubFolder } from '@shared/types'

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
    const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
    let content: string
    try {
      // Strict: a file in another encoding (an older Greek windows-1253 page, say) must not be
      // opened as UTF-8, or the first save would replace its letters for good.
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buf.subarray(3) : buf)
    } catch {
      return { ok: false, reason: 'encoding', size: st.size }
    }
    // The editor keeps one kind of line ending; take the one most lines use, so a save of a
    // mostly-LF file with a few CRLF lines doesn't rewrite every line.
    const crlf = content.split('\r\n').length - 1
    const lf = content.split('\n').length - 1 - crlf
    return { ok: true, content, mtime: st.mtimeMs, eol: crlf > lf ? 'crlf' : 'lf', bom }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'error', message: err.message }
  }
}

export async function writeTextFile(path: string, content: string, opts: FileWriteOptions = {}): Promise<FileWriteResult> {
  try {
    if (opts.expectMtime) {
      const st = await fs.stat(path).catch(() => null)
      // Changed since the editor read it (by Claude, say): don't overwrite that unasked.
      if (st && st.mtimeMs > opts.expectMtime + 1) return { ok: false, reason: 'changed', mtime: st.mtimeMs }
    }
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, opts.bom ? '﻿' + content : content, 'utf8')
    return { ok: true, mtime: (await fs.stat(path)).mtimeMs }
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  }
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

/** The folders directly inside one, leaving out hidden ones and node_modules. Empty if it can't be read. */
export async function listSubfolders(dir: string): Promise<SubFolder[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    return await Promise.all(
      dirs.map(async (e) => {
        const path = join(dir, e.name)
        const st = await fs.stat(path).catch(() => null)
        return { name: e.name, path, created: st ? st.birthtimeMs || st.ctimeMs : 0 }
      })
    )
  } catch {
    return []
  }
}

/** Which of these folders exist, in the same order. */
export async function dirsExist(paths: string[]): Promise<boolean[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return (await fs.stat(p)).isDirectory()
      } catch {
        return false
      }
    })
  )
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
