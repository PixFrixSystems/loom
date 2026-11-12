import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Claude Code labels every skill in ~/.claude/skills just "user". Where one actually came from is
// only known when something wrote it down: the skills installer (`npx skills add owner/repo`)
// keeps a lock file, and some skills name their author in their own frontmatter.

type LockEntry = { source?: string }

let lock: { at: number; skills: Record<string, LockEntry> } | null = null

function lockedSkills(): Record<string, LockEntry> {
  if (lock && Date.now() - lock.at < 60_000) return lock.skills
  let skills: Record<string, LockEntry> = {}
  try {
    const parsed = JSON.parse(readFileSync(join(homedir(), '.agents', '.skill-lock.json'), 'utf8')) as { skills?: unknown }
    if (parsed.skills && typeof parsed.skills === 'object') skills = parsed.skills as Record<string, LockEntry>
  } catch {
    // No installer, or a lock file it can't read: nothing to say.
  }
  lock = { at: Date.now(), skills }
  return skills
}

const authors = new Map<string, { at: number; author: string | null }>()

/** The `author:` in a SKILL.md's frontmatter, at the top level or under `metadata:`. */
function authorOf(file: string): string | null {
  const hit = authors.get(file)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.author
  let author: string | null = null
  try {
    const head = readFileSync(file, 'utf8').slice(0, 4000)
    const front = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    author = front?.match(/^\s*author:\s*["']?([^"'\r\n#]+?)["']?\s*$/m)?.[1]?.trim() || null
  } catch {
    // Not a folder skill, or unreadable.
  }
  authors.set(file, { at: Date.now(), author })
  return author
}

/**
 * Where one of your own skills came from, when that is known: the repository it was installed
 * from ("hyperframes", from heygen-com/hyperframes), else its author. Null when nothing says.
 */
export function skillOrigin(name: string): { label: string; detail: string } | null {
  const source = lockedSkills()[name]?.source
  if (typeof source === 'string' && source.trim()) {
    const repo = source.replace(/\.git$/, '').split(/[\\/]/).filter(Boolean).pop() ?? source
    return { label: repo, detail: `Installed from ${source}` }
  }
  const author = authorOf(join(homedir(), '.claude', 'skills', name, 'SKILL.md'))
  return author ? { label: author, detail: `By ${author}` } : null
}
