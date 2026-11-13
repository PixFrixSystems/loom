// Who this PC is signed in as, besides Claude: GitHub, Cloudflare and Vercel. These are the
// sign-ins of the tools themselves (Git's credential manager or the GitHub CLI, Wrangler, the
// Vercel CLI), which is what a push or a deploy from a terminal or from Claude goes out as.
//
// Loom only reads who is signed in. A token is used for nothing but asking its own service whose
// it is, and none is refreshed here: a refresh would replace the one the tool has saved.

import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ServiceAccount, ServiceId } from '@shared/types'

interface Deps {
  /** The folders of Loom's projects: one of them may have a tool installed that the PC as a whole has not */
  projects: () => string[]
}

interface Ran {
  ok: boolean
  /** The program isn't on this PC */
  missing: boolean
  out: string
}

/** Runs a program and gives what it printed. Never throws: a tool that isn't there is an answer too. */
function run(file: string, args: string[], opts: { timeout?: number; cwd?: string; shell?: boolean } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout ?? 8000, cwd: opts.cwd, shell: opts.shell, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } }, (err, stdout, stderr) => {
      const missing = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
      resolve({ ok: !err, missing, out: `${stdout ?? ''}\n${stderr ?? ''}` })
    })
  })
}

const firstLine = (text: string): string => text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''

// ---------- GitHub ----------

/** GitHub logins held by Git's credential manager, the one Git for Windows installs. */
async function credentialManagerLogins(): Promise<string[] | null> {
  const r = await run('git', ['credential-manager', 'github', 'list'])
  // Without the credential manager, git says the command doesn't exist.
  if (!r.ok) return null
  return r.out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z0-9-]{1,39}$/.test(l))
}

/** GitHub logins the GitHub CLI holds, the active one first; null without the CLI. */
async function cliLogins(): Promise<string[] | null> {
  const r = await run('gh', ['auth', 'status', '--hostname', 'github.com'])
  if (r.missing) return null
  const found = [...r.out.matchAll(/Logged in to github\.com (?:account|as) ([A-Za-z0-9-]+)/g)].map((m) => m[1])
  return [...new Set(found)]
}

async function github(): Promise<ServiceAccount> {
  const [manager, cli, name, email] = await Promise.all([
    credentialManagerLogins(),
    cliLogins(),
    run('git', ['config', '--global', 'user.name']),
    run('git', ['config', '--global', 'user.email'])
  ])
  const logins = [...new Set([...(manager ?? []), ...(cli ?? [])])]
  // Who a commit says it is by is a setting of git's, apart from the account that pushes it.
  const author = firstLine(name.ok ? name.out : '')
  const address = firstLine(email.ok ? email.out : '')
  const detail = author || address ? `Commits are made as ${[author, address ? `<${address}>` : ''].filter(Boolean).join(' ')}.` : undefined
  const via = manager?.length ? "Git's credential manager" : cli?.length ? 'the GitHub CLI' : manager ? "Git's credential manager" : cli ? 'the GitHub CLI' : undefined
  return {
    id: 'github',
    signedIn: logins.length > 0,
    who: logins[0],
    others: logins.slice(1),
    via,
    detail,
    // The credential manager signs in and out in windows of its own; the CLI does it in a terminal.
    signIn: manager ? { direct: true } : cli ? { run: 'gh auth login --web' } : undefined,
    signOut: manager?.length ? { direct: true } : cli?.length ? { run: 'gh auth logout' } : undefined
  }
}

// ---------- Cloudflare ----------

function wranglerConfig(): string | null {
  const places = [
    process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, '.wrangler', 'config', 'default.toml') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml') : '',
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml')
  ]
  return places.find((p) => p && existsSync(p)) ?? null
}

async function cloudflareApi<T>(path: string, token: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const body = (await r.json()) as { success?: boolean; result?: T }
    return body.success ? (body.result ?? null) : null
  } catch {
    return null
  }
}

/** A copy of Wrangler to ask: the PC's own, else one a project has installed. */
async function findWrangler(projects: string[]): Promise<{ file: string; cwd?: string } | null> {
  const where = await run('where', ['wrangler'])
  const global = where.ok ? where.out.split(/\r?\n/).map((l) => l.trim()).find((l) => /\.(cmd|exe)$/i.test(l)) : undefined
  if (global) return { file: global }
  for (const dir of projects) {
    const local = join(dir, 'node_modules', '.bin', 'wrangler.cmd')
    if (existsSync(local)) return { file: local, cwd: dir }
  }
  return null
}

async function cloudflare(deps: Deps): Promise<ServiceAccount> {
  const signIn = { run: 'npx wrangler login' }
  const file = wranglerConfig()
  let toml = ''
  try {
    if (file) toml = await fs.readFile(file, 'utf8')
  } catch {
    // Unreadable: the same as not there.
  }
  const value = (key: string): string => toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? ''
  const token = value('oauth_token')
  if (!token && !value('refresh_token')) return { id: 'cloudflare', signedIn: false, via: 'Wrangler', signIn }

  const account: ServiceAccount = { id: 'cloudflare', signedIn: true, via: 'Wrangler', signIn, signOut: { run: 'npx wrangler logout' } }
  // Cloudflare's accounts by name. A lone one named after the email itself ("you@mail.com's Account") adds nothing.
  const names = (list: string[], email: string): string | undefined => {
    const told = list.filter((n) => !n.toLowerCase().startsWith(email.toLowerCase()))
    if (!told.length) return undefined
    return `${list.length === 1 ? 'Account' : 'Accounts'}: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}.`
  }

  // The saved token lasts about an hour. While it does, Cloudflare itself says whose it is.
  const expires = Date.parse(value('expiration_time'))
  if (token && Number.isFinite(expires) && expires > Date.now() + 30_000) {
    const [user, accounts] = await Promise.all([cloudflareApi<{ email?: string }>('/user', token), cloudflareApi<{ name: string }[]>('/accounts?per_page=10', token)])
    if (user?.email) return { ...account, who: user.email, detail: names((accounts ?? []).map((a) => a.name), user.email) }
  }
  // Past that, Wrangler renews it when it next runs, so Wrangler is asked, where there is a copy.
  const wrangler = await findWrangler(deps.projects())
  if (wrangler) {
    const r = await run(`"${wrangler.file}"`, ['whoami'], { timeout: 30_000, cwd: wrangler.cwd, shell: true })
    const who = r.out.match(/associated with the email '?([^\s']+@[^\s'.]+(?:\.[^\s'.]+)+)/)?.[1]
    if (who) {
      const rows = [...r.out.matchAll(/^[│|]\s*(.+?)\s*[│|]\s*[0-9a-f]{32}\s*[│|]\s*$/gm)].map((m) => m[1])
      return { ...account, who, detail: names(rows, who) }
    }
    if (/not authenticated|wrangler login/i.test(r.out)) return { id: 'cloudflare', signedIn: false, via: 'Wrangler', signIn }
  }
  return account
}

// ---------- Vercel ----------

function vercelAuth(): string | null {
  const places = [
    process.env.APPDATA ? join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json') : '',
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'com.vercel.cli', 'auth.json') : '',
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.vercel', 'auth.json')
  ]
  return places.find((p) => p && existsSync(p)) ?? null
}

async function vercel(): Promise<ServiceAccount> {
  const signIn = { run: 'npx vercel login' }
  const file = vercelAuth()
  let auth: { token?: string; cachedUser?: { username?: string } } = {}
  try {
    if (file) auth = JSON.parse(await fs.readFile(file, 'utf8')) as typeof auth
  } catch {
    // Unreadable: the same as not there.
  }
  if (!auth.token) return { id: 'vercel', signedIn: false, via: 'the Vercel CLI', signIn }
  // The CLI keeps the name beside its token. Without it, Vercel is asked.
  let who = auth.cachedUser?.username
  if (!who) {
    try {
      const r = await fetch('https://api.vercel.com/v2/user', { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(6000) })
      if (r.ok) who = ((await r.json()) as { user?: { username?: string } }).user?.username
    } catch {
      // No answer: signed in, as far as the PC knows, by a name it can't read now.
    }
  }
  return { id: 'vercel', signedIn: true, who, via: 'the Vercel CLI', signIn, signOut: { run: 'npx vercel logout' } }
}

// ---------- All of them ----------

let deps: Deps = { projects: () => [] }
const last = new Map<ServiceId, { at: number; found: Promise<ServiceAccount | null> }>()

export function setupAccounts(d: Deps): void {
  deps = d
}

/**
 * One service's sign-in, or null when it couldn't be looked up. Each is asked for on its own, so
 * a slow one (Wrangler, when its token has to be renewed) doesn't hold the others back. Looked
 * up again when asked to, or after half a minute.
 */
export function serviceAccount(id: ServiceId, force = false): Promise<ServiceAccount | null> {
  const had = last.get(id)
  if (!force && had && Date.now() - had.at < 30_000) return had.found
  const look = id === 'github' ? github() : id === 'cloudflare' ? cloudflare(deps) : id === 'vercel' ? vercel() : Promise.resolve(null)
  const found = look.catch(() => null)
  last.set(id, { at: Date.now(), found })
  return found
}

/**
 * Signing in to or out of GitHub through Git's credential manager, which shows windows of its
 * own. The other services do it in a terminal, where what runs can be seen.
 */
export async function githubSign(what: 'in' | 'out', login?: string): Promise<{ ok: boolean; error?: string }> {
  if (what === 'out' && (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login))) return { ok: false, error: 'No account to sign out.' }
  // Signing in waits for the browser, so it gets minutes; signing out is done at once.
  const r = what === 'in' ? await run('git', ['credential-manager', 'github', 'login'], { timeout: 5 * 60_000 }) : await run('git', ['credential-manager', 'github', 'logout', login!])
  last.delete('github')
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.out.replace(/^(fatal|error):\s*/gim, '')) || 'Git did not answer.' }
}
