import { app } from 'electron'
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

// ---------- Text encodings ----------
// Most files are UTF-8. Two other kinds turn up on Windows all the time and are read and written
// back as they are: UTF-16 (Notepad's "Unicode", anything Windows PowerShell redirects with >) and
// the PC's older single-byte code page (windows-1253 for Greek, windows-1252 in the West), which
// old sites and notes still use. A file is never converted behind your back.

let ansi: Promise<string> | null = null
/** The PC's own code page for non-Unicode text, as an encoding name: "windows-1253" on a Greek Windows. */
function ansiCodePage(): Promise<string> {
  ansi ??= new Promise((resolve) => {
    execFile('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'], { windowsHide: true, timeout: 5000 }, (_e, out) => {
      const acp = String(out ?? '').match(/ACP\s+REG_SZ\s+(\d+)/)?.[1]
      resolve(acp && /^(874|125[0-8])$/.test(acp) ? `windows-${acp}` : 'windows-1252')
    })
  })
  return ansi
}

/** The older code page each language's files were saved in, before UTF-8 took over. */
const PAGE_OF_LANGUAGE: Record<string, string> = {
  el: 'windows-1253',
  ru: 'windows-1251',
  uk: 'windows-1251',
  bg: 'windows-1251',
  sr: 'windows-1251',
  mk: 'windows-1251',
  be: 'windows-1251',
  tr: 'windows-1254',
  he: 'windows-1255',
  ar: 'windows-1256',
  fa: 'windows-1256',
  pl: 'windows-1250',
  cs: 'windows-1250',
  sk: 'windows-1250',
  hu: 'windows-1250',
  ro: 'windows-1250',
  hr: 'windows-1250',
  sl: 'windows-1250',
  lt: 'windows-1257',
  lv: 'windows-1257',
  et: 'windows-1257',
  vi: 'windows-1258',
  th: 'windows-874'
}

/**
 * The code pages a file that isn't UTF-8 is most likely in, best guess first. The PC's own code
 * page says little on its own: a Greek user's Windows is often set to the Western one. So when
 * the bytes read like a script of their own (whole words of high bytes, as Greek or Cyrillic
 * have, where Western text has a lone accented letter here and there), the pages of the
 * languages set up in Windows are tried first.
 */
async function likelyCodePages(buf: Buffer): Promise<string[]> {
  const own = await ansiCodePage()
  const languages = [...app.getPreferredSystemLanguages(), app.getSystemLocale()].map((l) => l.slice(0, 2).toLowerCase())
  const theirs = languages.map((l) => PAGE_OF_LANGUAGE[l]).filter((p): p is string => !!p && p !== own)
  let high = 0
  let together = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < 0x80) continue
    high++
    if ((i > 0 && buf[i - 1] >= 0x80) || (i + 1 < buf.length && buf[i + 1] >= 0x80)) together++
  }
  const ownScript = high > 0 && together / high > 0.5
  return [...new Set(ownScript && own === 'windows-1252' ? [...theirs, own] : [own, ...theirs])]
}

/** UTF-16 without a byte order mark: plain text there has a zero in every other byte. */
function utf16WithoutMark(head: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (head.length < 4 || head.length % 2) head = head.subarray(0, head.length - (head.length % 2))
  let even = 0
  let odd = 0
  for (let i = 0; i < head.length; i++) if (head[i] === 0) i % 2 ? odd++ : even++
  const pairs = head.length / 2
  if (odd > pairs * 0.4 && even < pairs * 0.05) return 'utf-16le'
  if (even > pairs * 0.4 && odd < pairs * 0.05) return 'utf-16be'
  return null
}

const reverse = new Map<string, Map<string, number>>()
/** Text to bytes in a single-byte code page; a character it has no byte for is returned instead. */
function encodeSingleByte(text: string, encoding: string): Buffer | { missing: string } {
  let table = reverse.get(encoding)
  if (!table) {
    table = new Map()
    const decoder = new TextDecoder(encoding)
    for (let b = 0; b < 256; b++) {
      const ch = decoder.decode(Uint8Array.of(b))
      if (ch !== '\ufffd' && !table.has(ch)) table.set(ch, b)
    }
    reverse.set(encoding, table)
  }
  const out = Buffer.alloc(text.length)
  let n = 0
  for (const ch of text) {
    const b = table.get(ch)
    if (b === undefined) return { missing: ch }
    out[n++] = b
  }
  return out.subarray(0, n)
}

/** "windows-1253" as people know it: "Windows-1253", "UTF-16 LE". */
function encodingName(encoding: string): string {
  if (encoding === 'utf-16le') return 'UTF-16 LE'
  if (encoding === 'utf-16be') return 'UTF-16 BE'
  return encoding.replace(/^windows-/, 'Windows-')
}

export async function readTextFile(path: string): Promise<FileReadResult> {
  try {
    const st = await fs.stat(path)
    if (st.size > MAX_EDITABLE_BYTES) return { ok: false, reason: 'too-large', size: st.size }
    const buf = await fs.readFile(path)
    const head = buf.subarray(0, Math.min(buf.length, 8000))
    let encoding = 'utf-8'
    let bom = false
    let content: string
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
      encoding = buf[0] === 0xff ? 'utf-16le' : 'utf-16be'
      bom = true
      content = new TextDecoder(encoding).decode(buf.subarray(2))
    } else if (head.includes(0)) {
      const wide = utf16WithoutMark(head)
      if (!wide) return { ok: false, reason: 'binary', size: st.size }
      encoding = wide
      content = new TextDecoder(encoding).decode(buf)
    } else {
      bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      try {
        // Strict: a file in another encoding (an older Greek windows-1253 page, say) must not be
        // read as UTF-8, or the first save would replace its letters for good.
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buf.subarray(3) : buf)
      } catch {
        // Not UTF-8: an older code page. Every byte must have a letter in it and go back to the
        // same byte, or Loom leaves the file alone.
        const page = (await likelyCodePages(buf)).find((p) => {
          const text = new TextDecoder(p).decode(buf)
          const back = text.includes('\ufffd') ? null : encodeSingleByte(text, p)
          return !!back && Buffer.isBuffer(back) && back.equals(buf)
        })
        if (!page) return { ok: false, reason: 'encoding', size: st.size }
        encoding = page
        content = new TextDecoder(page).decode(buf)
        bom = false
      }
    }
    // The editor keeps one kind of line ending; take the one most lines use, so a save of a
    // mostly-LF file with a few CRLF lines doesn't rewrite every line.
    const crlf = content.split('\r\n').length - 1
    const lf = content.split('\n').length - 1 - crlf
    return { ok: true, content, mtime: st.mtimeMs, eol: crlf > lf ? 'crlf' : 'lf', bom, encoding }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'error', message: err.message }
  }
}

/** Names Windows won't take: reserved characters, control characters, a trailing dot or space. */
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]|^\.{1,2}$|[. ]$/

function nameProblem(path: string): string | null {
  const name = basename(path)
  if (!name.trim()) return 'A name is needed.'
  if (BAD_NAME.test(name)) return `"${name}" can't be used as a name on Windows.`
  return null
}

async function exists(path: string): Promise<boolean> {
  return fs.stat(path).then(
    () => true,
    () => false
  )
}

/** Creates an empty file or a folder; never replaces something already there. */
export async function createEntry(path: string, kind: 'file' | 'folder'): Promise<{ ok: boolean; error?: string }> {
  const problem = nameProblem(path)
  if (problem) return { ok: false, error: problem }
  if (await exists(path)) return { ok: false, error: `${basename(path)} already exists there.` }
  try {
    if (kind === 'folder') await fs.mkdir(path, { recursive: true })
    else {
      await fs.mkdir(dirname(path), { recursive: true })
      await fs.writeFile(path, '', { flag: 'wx' })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Renames a file or folder in place; a change of letter case alone is allowed. */
export async function renameEntry(from: string, to: string): Promise<{ ok: boolean; error?: string }> {
  const problem = nameProblem(to)
  if (problem) return { ok: false, error: problem }
  if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) return { ok: false, error: `${basename(to)} already exists there.` }
  try {
    await fs.rename(from, to)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
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
    // Written back in the encoding it was read in.
    const encoding = opts.encoding ?? 'utf-8'
    let bytes: Buffer
    if (encoding === 'utf-8') bytes = Buffer.from(opts.bom ? '\ufeff' + content : content, 'utf8')
    else if (encoding === 'utf-16le' || encoding === 'utf-16be') {
      bytes = Buffer.from(opts.bom ? '\ufeff' + content : content, 'utf16le')
      if (encoding === 'utf-16be') bytes.swap16()
    } else {
      const encoded = encodeSingleByte(content, encoding)
      if (!Buffer.isBuffer(encoded)) {
        return { ok: false, reason: 'error', message: `This file is saved as ${encodingName(encoding)}, which has no way to write "${encoded.missing}". Take that character out to save.` }
      }
      bytes = encoded
    }
    await fs.writeFile(path, bytes)
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
    if (files.length) {
      const list = files.slice(0, 60000).map((f) => f.replace(/\//g, '\\'))
      // Ignored by git, but exactly the files people open by hand.
      const env = (await fs.readdir(root).catch(() => [] as string[])).filter((n) => /^\.env(\..+)?$/.test(n) && !list.includes(n))
      return [...env, ...list]
    }
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
