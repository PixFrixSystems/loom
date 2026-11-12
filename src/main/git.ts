// Git for the Changes panel: what changed, diffs, staging, commits, branches, push and pull.
// Commands run in the repository root with paths relative to it, because a project can be a
// folder inside a bigger repository (for example one site in a monorepo).

import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { GitChanges, GitCommit, GitCommitFile, GitDiffResult, GitFile, GitResult } from '@shared/types'

// Paths are passed as they are, never as patterns: a Next.js folder like app\[id] would otherwise
// also match folders named i and d, and discarding one file could throw away another.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' } as Record<string, string>
delete ENV.ELECTRON_RUN_AS_NODE
const MAX_DIFF_BYTES = 2 * 1024 * 1024

function git(args: string[], cwd: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: ENV }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()))
      else resolve(stdout)
    })
  })
}

/** A git command whose output is the point, success or not. */
async function attempt(args: string[], cwd: string, timeout = 120000): Promise<GitResult> {
  try {
    return { ok: true, output: (await git(args, cwd, timeout)).trim() }
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  }
}

const roots = new Map<string, { root: string | null; at: number }>()

/** The repository a folder belongs to, or null when it isn't in one. */
export async function repoRoot(dir: string): Promise<string | null> {
  const key = dir.toLowerCase()
  const known = roots.get(key)
  // A repository is remembered; "not a repository" only for a few seconds, so a folder that gets
  // a git init or a clone shows up without restarting Loom.
  if (known && (known.root || Date.now() - known.at < 5000)) return known.root
  let root: string | null = null
  try {
    root = (await git(['rev-parse', '--show-toplevel'], dir, 8000)).trim().replace(/\//g, '\\')
  } catch {
    root = null
  }
  roots.set(key, { root, at: Date.now() })
  return root
}

const toRel = (root: string, abs: string): string => relative(root, abs).replace(/\\/g, '/')
const toAbs = (root: string, rel: string): string => join(root, rel)

/** Everything that changed in the project folder, staged and not. */
export async function gitChanges(dir: string): Promise<GitChanges | null> {
  const root = await repoRoot(dir)
  if (!root) return null
  let out: string
  try {
    out = await git(['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all', '--', '.'], dir, 15000)
  } catch {
    return null
  }
  const parts = out.split('\0')
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: GitFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.startsWith('## ')) {
      const head = entry.slice(3).replace(/^No commits yet on /, '')
      const extra = head.match(/\[(.*)\]$/)?.[1] ?? ''
      const names = head.replace(/\s*\[.*\]$/, '').split('...')
      branch = names[0].trim() || null
      if (branch?.startsWith('HEAD')) branch = null
      upstream = names[1]?.trim() || null
      ahead = Number(extra.match(/ahead (\d+)/)?.[1] ?? 0)
      behind = Number(extra.match(/behind (\d+)/)?.[1] ?? 0)
      continue
    }
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)
    let from: string | undefined
    // A rename or copy is followed by the old name.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') from = parts[++i]
    const untracked = x === '?' && y === '?'
    const conflicted = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
    files.push({
      path,
      abs: toAbs(root, path),
      index: x,
      work: y,
      staged: !untracked && x !== ' ' && !conflicted,
      unstaged: untracked || conflicted || y !== ' ',
      untracked,
      conflicted,
      from
    })
  }
  return { root, branch, upstream, ahead, behind, files }
}

async function showFile(root: string, spec: string): Promise<string | null> {
  try {
    return await git(['show', spec], root, 15000)
  } catch {
    return null
  }
}

/** A file before and after: since the last commit, or within one commit. */
export async function gitDiff(dir: string, abs: string, commit: string | null): Promise<GitDiffResult> {
  const root = await repoRoot(dir)
  if (!root) return { before: '', after: '', error: 'This folder is not in a git repository.' }
  const rel = toRel(root, abs)
  let before: string | null
  let after: string | null
  if (commit) {
    before = await showFile(root, `${commit}^:${rel}`)
    after = await showFile(root, `${commit}:${rel}`)
  } else {
    before = await showFile(root, `HEAD:${rel}`)
    try {
      const st = await fs.stat(abs)
      after = st.size > MAX_DIFF_BYTES ? null : await fs.readFile(abs, 'utf8')
      if (st.size > MAX_DIFF_BYTES) return { before: '', after: '', error: 'This file is too large to compare here.' }
    } catch {
      after = null
    }
  }
  const b = before ?? ''
  const a = after ?? ''
  if (b.includes('\0') || a.includes('\0')) return { before: '', after: '', binary: true }
  return { before: b, after: a }
}

async function paths(dir: string, abs: string[]): Promise<{ root: string; rels: string[] } | null> {
  const root = await repoRoot(dir)
  return root ? { root, rels: abs.map((p) => toRel(root, p)) } : null
}

export async function gitStage(dir: string, abs: string[]): Promise<GitResult> {
  const p = await paths(dir, abs)
  if (!p) return { ok: false, output: 'Not a git repository.' }
  return attempt(['add', '-A', '--', ...p.rels], p.root)
}

export async function gitUnstage(dir: string, abs: string[]): Promise<GitResult> {
  const p = await paths(dir, abs)
  if (!p) return { ok: false, output: 'Not a git repository.' }
  const r = await attempt(['restore', '--staged', '--', ...p.rels], p.root)
  // A repository with no commits yet has nothing to restore from.
  return r.ok ? r : attempt(['rm', '--cached', '-r', '-q', '--', ...p.rels], p.root)
}

/**
 * Throws away a file's changes. A copy of each file as it was goes to Loom's "discarded" folder
 * first, and new files go to the Recycle Bin, so nothing is lost for good by a misclick.
 */
export async function gitDiscard(dir: string, files: { abs: string; untracked: boolean; added: boolean }[]): Promise<GitResult> {
  const root = await repoRoot(dir)
  if (!root) return { ok: false, output: 'Not a git repository.' }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(app.getPath('userData'), 'discarded', stamp)
  const notes: string[] = []
  for (const f of files) {
    const rel = toRel(root, f.abs)
    if (existsSync(f.abs)) {
      const copy = join(backup, rel)
      await fs.mkdir(dirname(copy), { recursive: true })
      await fs.copyFile(f.abs, copy).catch(() => undefined)
    }
    if (f.untracked || f.added) {
      if (f.added) await attempt(['rm', '--cached', '-q', '--', rel], root)
      if (existsSync(f.abs)) await shell.trashItem(f.abs).catch((e) => notes.push(`${rel}: ${(e as Error).message}`))
    } else {
      const r = await attempt(['restore', '--source=HEAD', '--staged', '--worktree', '--', rel], root)
      if (!r.ok) notes.push(r.output)
    }
  }
  return { ok: notes.length === 0, output: notes.join('\n'), backup: existsSync(backup) ? backup : undefined }
}

/**
 * Commits what is staged; with `stageAll`, everything changed in the project folder first; with
 * `only`, just those files as they are now, leaving anything else that was staged staged.
 */
export async function gitCommit(dir: string, message: string, stageAll: boolean, only: string[] = []): Promise<GitResult> {
  const root = await repoRoot(dir)
  if (!root) return { ok: false, output: 'Not a git repository.' }
  let args = ['commit', '-F', '-']
  if (only.length) {
    const rels = only.map((p) => toRel(root, p))
    // New files must be known to git before a commit can name them.
    const r = await attempt(['add', '-A', '--', ...rels], root)
    if (!r.ok) return r
    args = ['commit', '-F', '-', '--only', '--', ...rels]
  } else if (stageAll) {
    const r = await attempt(['add', '-A', '--', '.'], dir)
    if (!r.ok) return r
  }
  // The message goes in on stdin so new lines and quotes survive as typed.
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd: root, env: ENV, windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('error', (e) => resolve({ ok: false, output: e.message }))
    p.on('close', (code) => resolve({ ok: code === 0, output: out.trim() }))
    p.stdin.end(message)
  })
}

export async function gitPush(dir: string): Promise<GitResult> {
  const c = await gitChanges(dir)
  if (!c) return { ok: false, output: 'Not a git repository.' }
  return c.upstream ? attempt(['push'], c.root) : attempt(['push', '-u', 'origin', 'HEAD'], c.root)
}

/** Only fast-forwards: anything that needs merging is a job for a chat, where it can be explained. */
export async function gitPull(dir: string): Promise<GitResult> {
  const root = await repoRoot(dir)
  if (!root) return { ok: false, output: 'Not a git repository.' }
  // --no-rebase: with pull.rebase set, git refuses to pull at all while files have uncommitted
  // changes; a fast-forward needs no rebase and leaves those changes alone.
  const r = await attempt(['pull', '--ff-only', '--no-rebase'], root)
  if (!r.ok && /not possible to fast-forward|diverging|divergent/i.test(r.output)) {
    return { ok: false, output: 'Your branch and the remote have both moved on, so this needs a merge. Ask Claude in a chat to pull and merge.' }
  }
  return r
}

export async function gitBranches(dir: string): Promise<{ current: string | null; branches: string[] }> {
  const root = await repoRoot(dir)
  if (!root) return { current: null, branches: [] }
  try {
    const list = (await git(['branch', '--format=%(refname:short)'], root)).split('\n').map((b) => b.trim()).filter(Boolean)
    const current = (await git(['branch', '--show-current'], root)).trim() || null
    return { current, branches: list }
  } catch {
    return { current: null, branches: [] }
  }
}

export async function gitSwitch(dir: string, branch: string, create: boolean): Promise<GitResult> {
  const root = await repoRoot(dir)
  if (!root) return { ok: false, output: 'Not a git repository.' }
  return attempt(create ? ['switch', '-c', branch] : ['switch', branch], root, 30000)
}

/** Recent commits that touched the project folder. */
export async function gitLog(dir: string, count = 30): Promise<GitCommit[]> {
  try {
    const out = await git(['log', `-n${count}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e', '--', '.'], dir)
    return out
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash, short, subject, author, at] = r.split('\x1f')
        return { hash, short, subject, author, at: Number(at) * 1000 }
      })
  } catch {
    return []
  }
}

export async function gitCommitFiles(dir: string, hash: string): Promise<GitCommitFile[]> {
  const root = await repoRoot(dir)
  if (!root) return []
  try {
    const parts = (await git(['show', '--name-status', '-z', '--format=', hash, '--', '.'], dir)).split('\0').filter(Boolean)
    const files: GitCommitFile[] = []
    for (let i = 0; i < parts.length; i++) {
      const status = parts[i]
      if (/^[RC]/.test(status)) {
        i++ // old name
      }
      const path = parts[++i]
      if (path) files.push({ path, abs: toAbs(root, path), status: status[0] })
    }
    return files
  } catch {
    return []
  }
}

/**
 * What a commit message has to describe: the chosen files, else the staged diff, else everything
 * that changed.
 */
export async function diffForMessage(dir: string, only: string[] = []): Promise<{ text: string; files: string } | null> {
  const root = await repoRoot(dir)
  if (!root) return null
  if (only.length) {
    const rels = only.map((p) => toRel(root, p))
    const status = await git(['status', '--short', '--untracked-files=all', '--', ...rels], root).catch(() => '')
    const stat = await git(['diff', 'HEAD', '--stat', '--', ...rels], root).catch(() => '')
    const diff = await git(['diff', 'HEAD', '--', ...rels], root).catch(() => '')
    return { text: diff.length > 60000 ? `${diff.slice(0, 60000)}\n(diff cut short)` : diff, files: `${status}\n${stat}`.trim() }
  }
  const staged = await git(['diff', '--cached', '--stat', '--', '.'], dir).catch(() => '')
  const useStaged = staged.trim().length > 0
  const stat = useStaged ? staged : await git(['diff', 'HEAD', '--stat', '--', '.'], dir).catch(() => '')
  const diff = await git(useStaged ? ['diff', '--cached', '--', '.'] : ['diff', 'HEAD', '--', '.'], dir).catch(() => '')
  const status = await git(['status', '--short', '--untracked-files=all', '--', '.'], dir).catch(() => '')
  const text = diff.length > 60000 ? `${diff.slice(0, 60000)}\n(diff cut short)` : diff
  return { text, files: `${status}\n${stat}`.trim() }
}
