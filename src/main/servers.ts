import { BrowserWindow } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, relative } from 'node:path'
import type { InstallStep, RunTarget, ServerInfo } from '@shared/types'
import { OutputTail } from './tail'

// ---------- Finding what a project runs ----------

/** Scripts that start something long-running, most likely first. Build, test and lint never qualify. */
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'develop', 'preview', 'watch', 'web', 'studio']
/** Where a repo usually keeps its website when the root is not the app. */
const APP_DIRS = ['web', 'apps/web', 'site', 'website', 'frontend', 'client', 'www']
const SKIP_DIRS = ['node_modules', 'dist', 'build', 'out']

type PackageJson = {
  scripts?: Record<string, unknown>
  packageManager?: unknown
  dependencies?: unknown
  devDependencies?: unknown
  workspaces?: unknown
}

function scriptRank(name: string): number {
  const [base, ...rest] = name.split(':')
  const i = SCRIPT_ORDER.indexOf(base)
  return i < 0 ? -1 : i * 10 + (rest.length ? 1 : 0)
}

async function readPackage(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return null
  }
}

/** npm, pnpm, yarn or bun: what package.json declares, else the nearest lockfile up the tree. */
function packageManager(dir: string, pkg: PackageJson): string {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : ''
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) return declared
  let cur = dir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(cur, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(cur, 'bun.lockb')) || existsSync(join(cur, 'bun.lock'))) return 'bun'
    if (existsSync(join(cur, 'package-lock.json'))) return 'npm'
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return 'npm'
}

// ---------- Packages that were never installed ----------

/** "npm run dev" and the like: the targets whose packages Loom knows how to install. */
const PM_RUN = /^(npm|pnpm|yarn|bun) run /

/** The workspace root above a package (npm, yarn or bun workspaces, pnpm-workspace.yaml), else the folder itself. */
async function installRoot(dir: string): Promise<string> {
  let cur = dirname(dir)
  for (let i = 0; i < 6 && cur !== dirname(cur); i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml')) || (await readPackage(cur))?.workspaces) return cur
    cur = dirname(cur)
  }
  return dir
}

/** node_modules, or Yarn's Plug'n'Play files, which stand in for it. */
function hasPackages(dir: string): boolean {
  return ['node_modules', '.pnp.cjs', '.pnp.js'].some((f) => existsSync(join(dir, f)))
}

/** The command that installs a target's packages, or null when it isn't an npm, pnpm, yarn or bun script. */
export async function installStep(target: RunTarget): Promise<InstallStep | null> {
  const pm = target.command.match(PM_RUN)?.[1]
  return pm ? { command: `${pm} install`, cwd: await installRoot(target.cwd) } : null
}

/**
 * Before running: a project that lists packages but never installed them (a fresh clone, say)
 * would stop at once with "Exited, code 1". Returns how to install them, or null when they are
 * installed or there are none.
 */
export async function missingPackages(target: RunTarget): Promise<InstallStep | null> {
  const step = await installStep(target)
  if (!step) return null
  const pkg = await readPackage(target.cwd)
  const count = (x: unknown): number => (x && typeof x === 'object' ? Object.keys(x).length : 0)
  if (!pkg || count(pkg.dependencies) + count(pkg.devDependencies) === 0) return null
  if (hasPackages(target.cwd) || (step.cwd !== target.cwd && hasPackages(step.cwd))) return null
  return step
}

async function targetsIn(dir: string, root: string): Promise<RunTarget[]> {
  const where = relative(root, dir).replace(/\\/g, '/')
  const key = where || '.'
  const out: RunTarget[] = []
  const pkg = await readPackage(dir)
  if (pkg?.scripts && typeof pkg.scripts === 'object') {
    const pm = packageManager(dir, pkg)
    const scripts = pkg.scripts
    const names = Object.keys(scripts)
      .filter((n) => typeof scripts[n] === 'string' && scriptRank(n) >= 0)
      .sort((a, b) => scriptRank(a) - scriptRank(b))
    for (const script of names) {
      out.push({ id: `${key}#${script}`, script, where, command: `${pm} run ${script}`, cwd: dir, detail: String(scripts[script]) })
    }
  }
  if (existsSync(join(dir, 'manage.py'))) {
    out.push({ id: `${key}#runserver`, script: 'runserver', where, command: 'python manage.py runserver', cwd: dir })
  }
  if (['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].some((f) => existsSync(join(dir, f)))) {
    out.push({ id: `${key}#compose`, script: 'docker compose', where, command: 'docker compose up', cwd: dir })
  }
  return out
}

/**
 * What a project can run. The project folder first; when it has nothing, the usual website
 * folders, then one to three app folders directly inside it (e.g. shop\web).
 */
export async function detectRunTargets(root: string, otherProjects: string[]): Promise<RunTarget[]> {
  if (!existsSync(root)) return []
  const direct = await targetsIn(root, root)
  if (direct.length) return direct

  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  if (norm(root) === norm(homedir()) || parse(root).root.toLowerCase() === `${norm(root)}\\`) return []

  for (const sub of APP_DIRS) {
    if (!existsSync(join(root, sub))) continue
    const found = await targetsIn(join(root, sub), root)
    if (found.length) return found
  }

  const others = new Set(otherProjects.map(norm))
  let apps: string[]
  try {
    apps = (await fs.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_') && !SKIP_DIRS.includes(d.name))
      .map((d) => join(root, d.name))
      .filter((p) => !others.has(norm(p)) && (existsSync(join(p, 'package.json')) || existsSync(join(p, 'manage.py'))))
  } catch {
    return []
  }
  if (apps.length === 0 || apps.length > 3) return []
  return (await Promise.all(apps.map((a) => targetsIn(a, root)))).flat()
}

// ---------- Running them ----------
// Servers run on plain pipes, not a console: a console repaints its screen and would wipe the
// log's first lines. FORCE_COLOR keeps their colours, and PYTHONUNBUFFERED makes Python print as it
// goes (through a pipe it would hold the server's address back until its buffer filled).

const MAX_LOG = 512 * 1024
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}[^\s'"<>)\]]*/i
const PORT_LINE = /\b(?:listening|running|started|ready|serving|available)\b[^\n]{0,60}?(?:\bport\s*:?\s*|localhost:)(\d{2,5})\b/i

interface Server {
  info: ServerInfo
  proc: ChildProcess | null
  log: OutputTail
  /** Characters written since Loom started this server, so a view can join the stream without gaps or repeats. */
  end: number
  /** Where the current step's own output starts, counted like `end` */
  from: number
  /** Install the packages first, then run */
  install: InstallStep | null
  scan: string
  stopping: boolean
  restarting: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const servers = new Map<string, Server>()

/** Every window hears about servers: a server's output tab may be in a window of its own. */
function send(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
}

/** Servers worth showing: everything except the ones the user stopped or dismissed. */
export function listServers(): ServerInfo[] {
  return [...servers.values()].filter((s) => s.info.status !== 'stopped').map((s) => ({ ...s.info }))
}

function publish(): void {
  send('server:update', listServers())
}

function setInfo(s: Server, patch: Partial<ServerInfo>): void {
  s.info = { ...s.info, ...patch }
  publish()
}

function append(s: Server, data: string): void {
  s.log.push(data)
  s.end += data.length
  send('server:data', s.info.id, data, s.end)
  if (!s.info.url && s.proc && !s.install) findUrl(s, data)
}

/** A dim line from Loom itself, on its own line with a blank line above it. */
function note(s: Server, text: string): void {
  const lead = !s.log.length ? '' : s.log.endsWith('\n') ? '\r\n' : '\r\n\r\n'
  append(s, `${lead}\x1b[2m${text}\x1b[0m\r\n`)
}

function findUrl(s: Server, data: string): void {
  s.scan = (s.scan + data.replace(ANSI, '')).slice(-6000)
  let url = s.scan.match(LOCAL_URL)?.[0] ?? null
  if (!url) {
    const port = s.scan.match(PORT_LINE)?.[1]
    if (port) url = `http://localhost:${port}`
  }
  if (!url) return
  url = url
    .replace('0.0.0.0', 'localhost')
    .replace(/\[::1?\]/, 'localhost')
    .replace(/[.,;:]+$/, '')
  setInfo(s, { url, status: 'running' })
}

const AGENT_MARKERS = [
  'CLAUDECODE',
  'AI_AGENT',
  'CODEX_THREAD_ID',
  'GEMINI_CLI',
  'QWEN_CODE',
  'AMP_CURRENT_THREAD_ID',
  'AUGMENT_AGENT',
  'ANTIGRAVITY_AGENT'
]

/**
 * Loom's own environment, minus what would make a tool think an AI agent launched it. Servers and
 * terminals here are the user's: Astro, for one, detaches into the background when it sees
 * CLAUDECODE, which happens when Loom itself was started from a Claude session.
 */
export function userEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, ...extra } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  for (const k of Object.keys(env)) {
    if (AGENT_MARKERS.includes(k) || k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDE_AGENT_')) delete env[k]
  }
  return env
}

function childEnv(): Record<string, string> {
  return userEnv({ FORCE_COLOR: '1', BROWSER: 'none', PYTHONUNBUFFERED: '1' })
}

function launch(s: Server): void {
  const { command, cwd } = s.install ?? s.info.target
  note(s, s.install ? `Installing dependencies: ${command} in ${cwd}` : `Running ${command} in ${cwd}`)
  s.from = s.end
  s.scan = ''
  if (!existsSync(cwd)) {
    note(s, 'That folder no longer exists.')
    setInfo(s, { status: 'exited', exitCode: -1 })
    return
  }
  let proc: ChildProcess
  try {
    proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
      cwd,
      env: childEnv(),
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (e) {
    note(s, `It could not start: ${(e as Error).message}`)
    setInfo(s, { status: 'exited', exitCode: -1 })
    return
  }
  s.proc = proc
  proc.stdout?.setEncoding('utf8')
  proc.stderr?.setEncoding('utf8')
  proc.stdout?.on('data', (d: string) => append(s, d))
  proc.stderr?.on('data', (d: string) => append(s, d))
  proc.stdin?.on('error', () => undefined)

  // Let the output drain before saying it ended, but don't wait on stray grandchildren holding it open.
  let code: number | null = null
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    exited(s, proc, code ?? -1)
  }
  proc.on('error', (e) => {
    note(s, `It could not start: ${e.message}`)
    finish()
  })
  proc.on('exit', (c) => {
    code = c
    setTimeout(finish, 1500)
  })
  proc.on('close', (c) => {
    code = code ?? c
    finish()
  })

  // Some servers never print an address. Still alive after half a minute counts as running.
  // Installing can take minutes, and isn't the server yet.
  if (s.timer) clearTimeout(s.timer)
  if (s.install) return
  s.timer = setTimeout(() => {
    if (s.proc === proc && s.info.status === 'starting') setInfo(s, { status: 'running' })
  }, 30_000)
}

// ---------- Saying why it ended ----------

/** Lines package managers and Node add around an error, which say nothing about its cause. */
const NOISE = [
  /^npm (?:error|ERR!)(?:\s*$|\s+(?:A complete log|code\b|path\b|command\b|workspace\b|location\b|errno\b|syscall\b|signal\b|Lifecycle script))/i,
  /\bELIFECYCLE\b/,
  /^error Command failed with exit code/i,
  /^info Visit https?:\/\//i,
  /^error: script ".*" exited with code/i,
  /^Node\.js v\d/,
  /^at\s/,
  /^operable program or batch file/i,
  /^>\s/,
  /^Require stack:/,
  /^-\s+[a-z]:\\/i,
  /^[\]{}()[,;^\s]+$/
]
const ERRORISH = /\berror\b|^\w*Error\b|^✘|is not recognized|not found|cannot\b|can't\b|failed|missing|EADDRINUSE|EACCES|ENOENT|ERR_/i

/** A path to a file rather than a package name, e.g. "./server.js" or "C:\app\index.js". */
function isPath(name: string): boolean {
  return /^(?:\.{1,2}[\\/]|[\\/]|[a-z]:[\\/])/i.test(name) && !/node_modules/i.test(name)
}

/**
 * What a run's output says about why it stopped. A command or module that can't be found means
 * the packages were never installed (or a new one was added since), unless it's the package
 * manager or Node itself that's missing.
 */
function explain(output: string, pm: string | undefined): { reason: string | null; needsInstall: boolean } {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.some((re) => re.test(l)))
  if (pm) {
    for (const line of lines) {
      const tool =
        line.match(/^'(.+?)' is not recognized as an internal or external command/i)?.[1] ??
        line.match(/(?:^|[\s:])([\w@./-]+): (?:command )?not found$/i)?.[1]
      if (tool && (tool === pm || tool === 'node')) return { reason: `${tool} isn't installed, or isn't on your PATH`, needsInstall: false }
      const mod = line.match(/Cannot find (?:module|package) '(.+?)'/i)?.[1]
      if (tool || (mod && !isPath(mod)) || /node_modules missing/i.test(line)) return { reason: 'Dependencies are not installed', needsInstall: true }
    }
  }
  const last = [...lines].reverse().find((l) => ERRORISH.test(l)) ?? lines[lines.length - 1]
  if (!last) return { reason: null, needsInstall: false }
  const line = last.replace(/^npm (?:error|ERR!)\s+/i, '')
  return { reason: line.length > 200 ? `${line.slice(0, 199)}…` : line, needsInstall: false }
}

/** The output of the current step only, at most its last few thousand characters. */
function stepOutput(s: Server): string {
  const text = s.log.text()
  return text.slice(-Math.max(0, Math.min(text.length, s.end - s.from, 16_000)))
}

/** A run starting over: nothing left from the last one. */
function fresh(s: Server): Partial<ServerInfo> {
  return { status: 'starting', url: null, exitCode: null, reason: null, needsInstall: false, installing: !!s.install, startedAt: Date.now() }
}

function exited(s: Server, proc: ChildProcess, code: number): void {
  if (s.proc !== proc) return
  s.proc = null
  if (s.timer) clearTimeout(s.timer)
  if (s.restarting) {
    s.restarting = false
    s.info = { ...s.info, ...fresh(s) }
    note(s, 'Restarting')
    launch(s)
    publish()
    return
  }
  if (s.stopping) {
    s.stopping = false
    s.install = null
    note(s, 'Stopped')
    setInfo(s, { status: 'stopped', exitCode: null, installing: false })
    return
  }
  if (s.install) {
    const step = s.install
    s.install = null
    if (code === 0) {
      // Installed: now the run itself.
      s.info = { ...s.info, installing: false }
      launch(s)
      publish()
      return
    }
    const { reason } = explain(stepOutput(s), undefined)
    note(s, `${step.command} failed with code ${code}`)
    setInfo(s, { status: 'exited', exitCode: code, installing: false, needsInstall: false, reason: reason ?? `${step.command} failed` })
    return
  }
  const pm = s.info.target.command.match(PM_RUN)?.[1]
  const { reason, needsInstall } = code === 0 ? { reason: null, needsInstall: false } : explain(stepOutput(s), pm)
  note(s, `Exited with code ${code}`)
  if (needsInstall) note(s, `Dependencies are not installed. Install and run installs them with ${pm} install first.`)
  setInfo(s, { status: 'exited', exitCode: code, reason, needsInstall })
}

/** Ends the command and everything it started (npm, node, the dev server's workers). */
function killTree(proc: ChildProcess): void {
  if (!proc.pid) return
  const k = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true })
  k.on('error', () => proc.kill())
}

/** Starts a target, after installing its packages when `install` is set. */
export async function startServer(projectId: string, target: RunTarget, install = false): Promise<ServerInfo> {
  const id = `${projectId}|${target.id}`
  const step = install ? await installStep(target) : null
  const prev = servers.get(id)
  if (prev?.proc) return { ...prev.info }
  const s: Server = {
    info: { id, projectId, target, status: 'starting', url: null, exitCode: null, startedAt: Date.now(), installing: !!step },
    proc: null,
    log: prev?.log ?? new OutputTail(MAX_LOG),
    end: prev?.end ?? 0,
    from: prev?.end ?? 0,
    install: step,
    scan: '',
    stopping: false,
    restarting: false,
    timer: null
  }
  servers.set(id, s)
  launch(s)
  publish()
  return { ...s.info }
}

export function stopServer(id: string): void {
  const s = servers.get(id)
  if (!s) return
  if (!s.proc) {
    setInfo(s, { status: 'stopped' })
    return
  }
  s.stopping = true
  s.restarting = false
  setInfo(s, { status: 'stopping' })
  killTree(s.proc)
}

/** Runs it again; `install` installs its packages first (only for one that isn't running). */
export async function restartServer(id: string, install = false): Promise<void> {
  const s = servers.get(id)
  if (!s) return
  if (!s.proc) {
    const step = install ? await installStep(s.info.target) : null
    if (s.proc) return
    s.install = step
    s.info = { ...s.info, ...fresh(s) }
    launch(s)
    publish()
    return
  }
  s.restarting = true
  s.stopping = false
  setInfo(s, { status: 'starting', url: null, reason: null })
  killTree(s.proc)
}

/** Takes a server that ended on its own off the list. Its output stays readable. */
export function dismissServer(id: string): void {
  const s = servers.get(id)
  if (s && !s.proc) setInfo(s, { status: 'stopped' })
}

export function serverLog(id: string): { text: string; end: number } | null {
  const s = servers.get(id)
  return s ? { text: s.log.text(), end: s.end } : null
}

/** Keys typed into the output tab, for the odd server that asks a question. Shown as typed. */
export function writeServer(id: string, data: string): void {
  const s = servers.get(id)
  const stdin = s?.proc?.stdin
  if (!s || !stdin || stdin.destroyed) return
  stdin.write(data.replace(/\r/g, '\n'))
  append(s, data.replace(/\r/g, '\r\n'))
}

/**
 * On quit: nothing Loom started may outlive it. One taskkill for every server, with a time limit,
 * so a stalled one can't keep Loom from quitting. A server caught mid-restart is not started again.
 */
export function killAllServers(): void {
  const pids: string[] = []
  for (const s of servers.values()) {
    s.restarting = false
    if (!s.proc) continue
    s.stopping = true
    if (s.proc.pid) pids.push('/PID', String(s.proc.pid))
  }
  if (pids.length) spawnSync('taskkill', ['/T', '/F', ...pids], { windowsHide: true, timeout: 5000 })
}
