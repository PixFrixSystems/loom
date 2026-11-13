import { BrowserWindow } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { promises as dnsp } from 'node:dns'
import { existsSync } from 'node:fs'
import { request } from 'node:https'
import { join } from 'node:path'
import type { ServerInfo, TunnelInfo } from '@shared/types'

// A public link to a dev server, for showing a site to a client: a Cloudflare Quick Tunnel
// (cloudflared tunnel --url), which needs no Cloudflare account, domain or DNS set-up and hands
// out a random https://….trycloudflare.com address. It lives as long as Loom keeps cloudflared
// running: until you stop sharing, the server stops, or Loom quits.

interface Tunnel {
  info: TunnelInfo
  proc: ChildProcess
  /** The local address it forwards to, to notice when the server moves to another port */
  origin: string
  out: string
  stopping: boolean
}

const tunnels = new Map<string, Tunnel>()
/** Links that failed lately: they stay on show for half a minute, so the reason can be read. */
const failures = new Map<string, TunnelInfo>()

function send(): void {
  const list = listTunnels()
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('tunnel:update', list)
}

/** Every link open or on its way, and the ones that failed lately (with why). */
export function listTunnels(): TunnelInfo[] {
  return [...[...tunnels.values()].map((t) => ({ ...t.info })), ...[...failures.values()].filter((f) => !tunnels.has(f.serverId))]
}

function set(t: Tunnel, patch: Partial<TunnelInfo>): void {
  t.info = { ...t.info, ...patch }
  send()
}

/** cloudflared, wherever it is: on the PATH, or where its installer and winget put it. */
export function findCloudflared(): string | null {
  const found = spawnSync('where', ['cloudflared'], { windowsHide: true, encoding: 'utf8', timeout: 5000 })
  const onPath = found.status === 0 ? found.stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'))?.trim() : undefined
  if (onPath && existsSync(onPath)) return onPath
  const places = [
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')
  ].filter((p): p is string => !!p)
  return places.find((p) => existsSync(p)) ?? null
}

const PUBLIC = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/**
 * Whether the public link answers yet. A brand-new trycloudflare name can take up to a minute to
 * resolve, so this asks Cloudflare's own resolver, never the PC's: an early "no such name" in
 * Windows' cache would keep the link dead in your own browser for minutes after it works.
 */
async function answers(url: string): Promise<boolean> {
  const host = new URL(url).hostname
  const resolver = new dnsp.Resolver({ timeout: 4000, tries: 1 })
  resolver.setServers(['1.1.1.1', '1.0.0.1'])
  let addresses: string[]
  try {
    addresses = await resolver.resolve4(host)
  } catch {
    return false
  }
  if (!addresses.length) return false
  return new Promise((resolve) => {
    const req = request(
      url,
      {
        method: 'GET',
        timeout: 8000,
        headers: { 'User-Agent': 'Loom' },
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, addresses.map((address) => ({ address, family: 4 }))) : cb(null, addresses[0], 4)) as never
      },
      (res) => {
        res.resume()
        // Cloudflare's own "the tunnel isn't connected" pages; anything else came from the server.
        resolve(![502, 503, 530].includes(res.statusCode ?? 0))
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

/** Checks every two seconds for up to two minutes, then calls it live either way. */
async function waitUntilAnswering(t: Tunnel): Promise<void> {
  const until = Date.now() + 120_000
  while (!t.stopping && tunnels.get(t.info.serverId) === t && Date.now() < until) {
    if (await answers(t.info.url!)) return set(t, { state: 'live', slow: false })
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (!t.stopping && tunnels.get(t.info.serverId) === t) set(t, { state: 'live', slow: true })
}

/** The last error cloudflared wrote, as a sentence. */
function lastError(out: string): string {
  const line = out
    .split(/\r?\n/)
    .filter((l) => /\bERR\b|error|failed/i.test(l))
    .pop()
  if (!line) return 'Cloudflare could not open a public link.'
  if (/429|Too Many Requests/i.test(line)) return 'Cloudflare is handing out too many links right now. Try again in a minute.'
  if (/no such host|dial tcp|lookup|i\/o timeout|connection refused/i.test(line)) return "Couldn't reach Cloudflare. Check the connection and try again."
  return line.replace(/^\S+\s+(ERR|WRN|INF)\s+/, '').slice(0, 200)
}

export type ShareResult = { ok: true } | { ok: false; missing?: boolean; message?: string }

/** Opens a public link to a running server. `env`: the user's environment, as servers get it. */
export function startTunnel(server: ServerInfo, env: Record<string, string>): ShareResult {
  if (tunnels.has(server.id)) return { ok: true }
  if (server.status !== 'running' || !server.url) return { ok: false, message: 'The server has to be running first.' }
  const exe = findCloudflared()
  if (!exe) return { ok: false, missing: true }
  const local = new URL(server.url)
  const origin = `${local.protocol}//${local.host}`
  const port = local.port || (local.protocol === 'https:' ? '443' : '80')
  const args = ['tunnel', '--no-autoupdate', '--url', origin]
  // The server sees "localhost" as the host it was asked for: Vite and others refuse requests for
  // any other name ("Blocked request. This host is not allowed").
  args.push('--http-host-header', `localhost:${port}`)
  // A dev server on https has its own certificate, which only this PC trusts.
  if (local.protocol === 'https:') args.push('--no-tls-verify')
  const proc = spawn(exe, args, { windowsHide: true, env })
  const t: Tunnel = {
    info: { serverId: server.id, state: 'starting', path: local.pathname === '/' ? '' : local.pathname, startedAt: Date.now() },
    proc,
    origin,
    out: '',
    stopping: false
  }
  tunnels.set(server.id, t)
  const read = (d: Buffer): void => {
    t.out = (t.out + d.toString()).slice(-20000)
    if (t.info.state !== 'starting') return
    const url = t.info.url ?? t.out.match(PUBLIC)?.[0]
    if (url && !t.info.url) t.info = { ...t.info, url }
    // The address comes first; it carries traffic once a connection to Cloudflare is registered.
    if (url && /Registered tunnel connection/i.test(t.out)) {
      set(t, { state: 'checking', url })
      void waitUntilAnswering(t)
    }
  }
  proc.stdout?.on('data', read)
  proc.stderr?.on('data', read)
  proc.on('error', (e) => {
    if (tunnels.get(server.id) !== t) return
    tunnels.delete(server.id)
    set(t, { state: 'error', error: e.message })
    finished(t)
  })
  proc.on('exit', () => {
    if (tunnels.get(server.id) !== t) return
    tunnels.delete(server.id)
    if (!t.stopping) {
      t.info = { ...t.info, state: 'error', error: lastError(t.out) }
      finished(t)
    }
    send()
  })
  send()
  return { ok: true }
}

function finished(t: Tunnel): void {
  failures.set(t.info.serverId, t.info)
  send()
  setTimeout(() => {
    if (failures.get(t.info.serverId) === t.info) {
      failures.delete(t.info.serverId)
      send()
    }
  }, 30_000)
}

function kill(t: Tunnel): void {
  t.stopping = true
  if (t.proc.pid) spawn('taskkill', ['/pid', String(t.proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => t.proc.kill())
}

export function stopTunnel(serverId: string): void {
  failures.delete(serverId)
  const t = tunnels.get(serverId)
  if (!t) return send()
  tunnels.delete(serverId)
  kill(t)
  send()
}

/**
 * Keeps links honest as servers change: a server that stopped or ended takes its link with it,
 * and so does one that came back on another port (the link would show nothing).
 */
export function serversChanged(list: ServerInfo[]): void {
  for (const [id, t] of tunnels) {
    const s = list.find((x) => x.id === id)
    const gone = !s || s.status === 'stopped' || s.status === 'exited'
    const moved = !!s?.url && (() => {
      const u = new URL(s.url!)
      return `${u.protocol}//${u.host}` !== t.origin
    })()
    if (gone || moved) stopTunnel(id)
  }
}

/** On quit: no public link outlives Loom. */
export function killAllTunnels(): void {
  const pids = [...tunnels.values()].flatMap((t) => (t.proc.pid ? ['/PID', String(t.proc.pid)] : []))
  tunnels.clear()
  if (pids.length) spawnSync('taskkill', ['/T', '/F', ...pids], { windowsHide: true, timeout: 5000 })
}
