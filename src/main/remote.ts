// Phone access, on the PC: Loom's connection to the relay, the phones linked to it, and what a
// phone may ask for. The page a phone opens is at remote.loom.baby; how the two talk, and why the
// relay can't read any of it, is in src/shared/remote.ts.
//
// The chats themselves live in Loom's windows. This file only carries messages: a phone's
// requests go to the window that shows the chat, and that window sends back what the phone sees.

import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { EffortLevel, PermissionResponse } from '@shared/types'
import {
  b64u,
  aesKey,
  deviceKeyBytes,
  ID_PATTERN,
  keyPair,
  MAX_DEVICES,
  MAX_SEND,
  PAIRING_MS,
  pairingId,
  pairingKey,
  pairingUrl,
  publicKey,
  randomBytes,
  randomId,
  REMOTE_ADDRESS,
  REMOTE_VERSION,
  SECRET_BYTES,
  seal,
  sealContext,
  unb64u,
  unseal,
  type Envelope,
  type FromPhone,
  type Hi,
  type PairDown,
  type PairUp,
  type PhoneAction,
  type RelayData,
  type RelayNotice,
  type RemoteList,
  type RemoteStatus,
  type ToPhone
} from '@shared/remote'

interface Device {
  id: string
  name: string
  linkedAt: number
  seenAt?: number
  /** The phone's key, as saved */
  raw: string
  key?: Promise<CryptoKey>
}

interface Config {
  enabled: boolean
  room: string
  /** Shows the relay that this Loom is the room's PC */
  roomKey: string
  devices: Device[]
}

/** One phone's connection, from its hi until it leaves */
interface Session {
  device: Device
  sid: string
  out: number
  seen: number
  /** The chat this phone has open */
  watching: string | null
  chain: Promise<void>
}

interface SavedFile {
  v: 1
  enabled: boolean
  room: string
  devices: { id: string; name: string; linkedAt: number; seenAt?: number }[]
  /** The room key and the phones' keys, encrypted for this Windows account when it can be */
  secrets: string
  protected: boolean
}

interface Deps {
  main: () => BrowserWindow | null
}

const ADDRESS = (process.env.LOOM_REMOTE_URL || REMOTE_ADDRESS).replace(/\/+$/, '')
const file = (): string => join(app.getPath('userData'), 'remote.json')

let deps: Deps = { main: () => null }
let cfg: Config = { enabled: false, room: '', roomKey: '', devices: [] }
let ws: WebSocket | null = null
let relay: RemoteStatus['relay'] = 'off'
let relayError: string | undefined
let retry: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let beat: ReturnType<typeof setInterval> | null = null
let pongDue: ReturnType<typeof setTimeout> | null = null
let pairing: { id: string; secret: Uint8Array<ArrayBuffer>; url: string; expiresAt: number; fails: number; timer: ReturnType<typeof setTimeout> } | null = null
let lastList: RemoteList | null = null
/** Loom is quitting: no new connections */
let closing = false
const sessions = new Map<string, Session>()

// ---------- Saved on disk ----------

function fresh(): Config {
  return { enabled: false, room: randomId(), roomKey: b64u(randomBytes(32)), devices: [] }
}

function load(): Config {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as SavedFile
    const secrets = JSON.parse(saved.protected ? safeStorage.decryptString(Buffer.from(saved.secrets, 'base64')) : saved.secrets) as {
      roomKey: string
      keys: Record<string, string>
    }
    if (!ID_PATTERN.test(saved.room) || typeof secrets.roomKey !== 'string') return fresh()
    return {
      enabled: saved.enabled === true,
      room: saved.room,
      roomKey: secrets.roomKey,
      devices: saved.devices.filter((d) => ID_PATTERN.test(d.id) && typeof secrets.keys[d.id] === 'string').map((d) => ({ ...d, raw: secrets.keys[d.id] }))
    }
  } catch {
    // Nothing saved yet, or keys this Windows account can't read: start clean, with nothing linked.
    return fresh()
  }
}

let saving: Promise<void> = Promise.resolve()
function save(): void {
  const secrets = JSON.stringify({ roomKey: cfg.roomKey, keys: Object.fromEntries(cfg.devices.map((d) => [d.id, d.raw])) })
  const protect = safeStorage.isEncryptionAvailable()
  const out: SavedFile = {
    v: 1,
    enabled: cfg.enabled,
    room: cfg.room,
    devices: cfg.devices.map(({ id, name, linkedAt, seenAt }) => ({ id, name, linkedAt, seenAt })),
    secrets: protect ? safeStorage.encryptString(secrets).toString('base64') : secrets,
    protected: protect
  }
  saving = saving
    .then(async () => {
      const tmp = `${file()}.tmp`
      await fs.writeFile(tmp, JSON.stringify(out, null, 2), 'utf8')
      await fs.rename(tmp, file())
    })
    .catch((e) => console.error('[remote] save', e))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 5000)
}

// ---------- Loom's windows ----------

function toWindows(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
}

function status(): RemoteStatus {
  return {
    enabled: cfg.enabled,
    relay,
    error: relayError,
    devices: cfg.devices.map((d) => ({ id: d.id, name: d.name, linkedAt: d.linkedAt, seenAt: d.seenAt, connected: sessions.has(d.id) })),
    pairing: pairing ? { url: pairing.url, expiresAt: pairing.expiresAt } : null,
    address: ADDRESS
  }
}

function emitStatus(): void {
  toWindows('remote:status', status())
}

/** The chats phones have open right now */
function watched(): string[] {
  return [...new Set([...sessions.values()].flatMap((s) => (s.watching ? [s.watching] : [])))]
}

function watchingChanged(): void {
  toWindows('remote:watching', watched())
}

// ---------- The relay ----------

/** Loom stays connected only while a phone could use it: one is linked, or a QR code is showing. */
function wanted(): boolean {
  return !closing && cfg.enabled && (cfg.devices.length > 0 || !!pairing)
}

function sendRaw(frame: RelayData): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
}

function stopBeat(): void {
  if (beat) clearInterval(beat)
  if (pongDue) clearTimeout(pongDue)
  beat = pongDue = null
}

function dropSessions(): void {
  if (!sessions.size) return
  const had = watched().length > 0
  sessions.clear()
  if (had) watchingChanged()
}

function disconnect(): void {
  if (retry) clearTimeout(retry)
  retry = null
  stopBeat()
  const old = ws
  ws = null
  old?.close()
  dropSessions()
  relay = 'off'
  relayError = undefined
}

/** Opens or closes the connection to match what is wanted now. */
function sync(): void {
  if (!wanted()) {
    disconnect()
    return emitStatus()
  }
  if (!ws) connect()
  emitStatus()
}

function connect(): void {
  if (retry) clearTimeout(retry)
  retry = null
  relay = 'connecting'
  relayError = undefined
  let socket: WebSocket
  try {
    socket = new WebSocket(`${ADDRESS.replace(/^http/, 'ws')}/v1/room/${cfg.room}?role=pc`)
  } catch (e) {
    console.error('[remote] connect', e)
    return again()
  }
  ws = socket
  socket.addEventListener('open', () => {
    if (socket !== ws) return
    socket.send(JSON.stringify({ t: 'auth', key: cfg.roomKey }))
    // A connection that died without saying so (the PC slept, the network changed) is found by
    // a ping the relay stops answering.
    stopBeat()
    beat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send('ping')
      pongDue ??= setTimeout(() => socket.close(), 10_000)
    }, 30_000)
  })
  socket.addEventListener('message', (e) => {
    if (socket !== ws || typeof e.data !== 'string') return
    if (e.data === 'pong') {
      if (pongDue) clearTimeout(pongDue)
      pongDue = null
      return
    }
    const text = e.data
    inbox = inbox.then(() => onFrame(text)).catch((err) => console.error('[remote]', err))
  })
  socket.addEventListener('close', () => {
    if (socket !== ws) return
    ws = null
    stopBeat()
    dropSessions()
    again()
  })
  socket.addEventListener('error', () => {
    // A close follows; that is where it is handled.
  })
}

/** Tries again later, waiting longer each time up to half a minute. */
function again(): void {
  if (!wanted() || relay === 'error') return emitStatus()
  relay = 'connecting'
  const wait = Math.min(30_000, 1000 * 2 ** attempts++) + Math.random() * 500
  retry = setTimeout(() => {
    retry = null
    if (wanted()) connect()
  }, wait)
  emitStatus()
}

// One message at a time, in the order they came: opening a seal takes a moment.
let inbox: Promise<void> = Promise.resolve()

async function onFrame(text: string): Promise<void> {
  let f: RelayNotice | RelayData
  try {
    f = JSON.parse(text) as RelayNotice | RelayData
  } catch {
    return
  }
  if ('t' in f) {
    if (f.t === 'phones') {
      relay = 'online'
      attempts = 0
      emitStatus()
    } else if (f.t === 'leave') {
      endSession(f.from)
    } else if (f.t === 'denied') {
      relay = 'error'
      relayError = f.reason
      emitStatus()
    }
    return
  }
  if (typeof f.from !== 'string' || !ID_PATTERN.test(f.from) || typeof f.d !== 'string') return
  if (typeof f.p === 'string') return onPair(f.from, f.p, f.d)
  return onDeviceData(f.from, f.d)
}

// ---------- Linking a phone ----------

function cancelPairing(): void {
  if (!pairing) return
  clearTimeout(pairing.timer)
  pairing = null
  sync()
}

async function startPairing(): Promise<RemoteStatus> {
  const secret = randomBytes(SECRET_BYTES)
  const id = await pairingId(secret)
  if (pairing) clearTimeout(pairing.timer)
  pairing = {
    id,
    secret,
    url: pairingUrl(ADDRESS, cfg.room, secret),
    expiresAt: Date.now() + PAIRING_MS,
    fails: 0,
    timer: setTimeout(cancelPairing, PAIRING_MS)
  }
  if (!cfg.enabled) {
    cfg.enabled = true
    save()
  }
  sync()
  return status()
}

function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : ''
  return text || 'Phone'
}

async function onPair(from: string, pairId: string, sealed: string): Promise<void> {
  const pr = pairing
  if (!pr || pr.id !== pairId || Date.now() > pr.expiresAt) return sendRaw({ to: from, x: 'expired' })
  const key = await pairingKey(pr.secret, pr.id)
  const msg = await unseal<PairUp>(key, sealContext('pair', pr.id, 'up'), sealed)
  if (!msg || msg.t !== 'pair' || typeof msg.pub !== 'string') {
    // Not made with this code's secret. A few of those and the code is withdrawn.
    if (++pr.fails >= 5) cancelPairing()
    return
  }
  const reply = async (m: PairDown): Promise<void> => sendRaw({ to: from, p: pr.id, d: await seal(key, sealContext('pair', pr.id, 'down'), m) })
  if (msg.v !== REMOTE_VERSION) return reply({ t: 'pair-failed', reason: 'version' })
  if (cfg.devices.filter((d) => d.id !== from).length >= MAX_DEVICES) return reply({ t: 'pair-failed', reason: 'full' })
  const pair = await keyPair()
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = await deviceKeyBytes(pair, msg.pub, pr.secret, from)
  } catch {
    if (++pr.fails >= 5) cancelPairing()
    return
  }
  // A code links one phone.
  clearTimeout(pr.timer)
  pairing = null
  endSession(from)
  cfg.devices = [...cfg.devices.filter((d) => d.id !== from), { id: from, name: cleanName(msg.name), linkedAt: Date.now(), raw: b64u(raw) }]
  save()
  await reply({ t: 'paired', pub: await publicKey(pair), pc: hostname() })
  emitStatus()
}

// ---------- A linked phone ----------

function keyOf(device: Device): Promise<CryptoKey> {
  return (device.key ??= aesKey(unb64u(device.raw)))
}

function endSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  if (s.watching) watchingChanged()
  emitStatus()
}

/** Sends a phone a message, sealed, in the order asked. */
function post(s: Session, m: ToPhone): void {
  const n = s.out++
  s.chain = s.chain
    .then(async () => {
      if (sessions.get(s.device.id) !== s) return
      const env: Envelope<ToPhone> = { sid: s.sid, n, m }
      sendRaw({ to: s.device.id, d: await seal(await keyOf(s.device), sealContext('device', s.device.id, 'down'), env) })
    })
    .catch((e) => console.error('[remote] send', e))
}

async function onDeviceData(from: string, sealed: string): Promise<void> {
  const device = cfg.devices.find((d) => d.id === from)
  // A phone removed here, or one that never linked: tell it so in plain words. It holds no key
  // of ours to seal with.
  if (!device) return sendRaw({ to: from, x: 'unknown' })
  const msg = await unseal<Hi | Envelope<FromPhone>>(await keyOf(device), sealContext('device', from, 'up'), sealed)
  if (!msg || typeof msg !== 'object') return
  if ('t' in msg) {
    if (msg.t !== 'hi' || typeof msg.nonce !== 'string' || msg.nonce.length > 64) return
    const s: Session = { device, sid: randomId(), out: 0, seen: -1, watching: null, chain: Promise.resolve() }
    const before = sessions.get(from)
    sessions.set(from, s)
    if (before?.watching) watchingChanged()
    device.seenAt = Date.now()
    saveSoon()
    post(s, { t: 'hello', nonce: msg.nonce, pc: hostname(), version: app.getVersion() })
    return emitStatus()
  }
  const s = sessions.get(from)
  // Only this connection's messages, each once, in order: anything else is an old one sent again.
  if (!s || msg.sid !== s.sid || typeof msg.n !== 'number' || msg.n <= s.seen) return
  s.seen = msg.n
  onPhone(s, msg.m)
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80
const EFFORTS: unknown[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies EffortLevel[]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A phone's answer to an approval, a question or a plan, kept to what Loom's own buttons can send. */
function cleanResponse(r: unknown): PermissionResponse | null {
  if (!r || typeof r !== 'object') return null
  const v = r as { decision?: unknown; message?: unknown; answers?: unknown; mode?: unknown }
  const message = typeof v.message === 'string' ? v.message.slice(0, 20_000) : undefined
  switch (v.decision) {
    case 'allow':
    case 'allow-always':
      return { decision: v.decision }
    case 'deny':
    case 'reject-plan':
      return { decision: v.decision, message }
    case 'approve-plan':
      return v.mode === 'default' || v.mode === 'acceptEdits' ? { decision: 'approve-plan', mode: v.mode } : null
    case 'answer': {
      if (!v.answers || typeof v.answers !== 'object') return null
      const entries = Object.entries(v.answers as Record<string, unknown>)
      if (entries.length > 20 || entries.some(([, a]) => typeof a !== 'string')) return null
      return { decision: 'answer', answers: Object.fromEntries(entries.map(([q, a]) => [q.slice(0, 2000), (a as string).slice(0, 20_000)])) }
    }
  }
  return null
}

function onPhone(s: Session, m: FromPhone): void {
  if (!m || typeof m !== 'object') return
  const act = (action: PhoneAction): void => toWindows('remote:act', action, s.device.id)
  switch (m.t) {
    case 'list':
      if (lastList) post(s, { t: 'list', list: lastList })
      // The main window answers with the list as it is now.
      deps.main()?.webContents.send('remote:list-request')
      break
    case 'open':
      if (!isId(m.tabId)) return
      s.watching = m.tabId
      watchingChanged()
      toWindows('remote:open', m.tabId, s.device.id)
      break
    case 'close':
      if (s.watching !== m.tabId) return
      s.watching = null
      watchingChanged()
      break
    case 'more':
      if (isId(m.tabId) && isId(m.before)) act({ t: 'more', tabId: m.tabId, before: m.before })
      break
    case 'send':
      if (!isId(m.tabId) || typeof m.text !== 'string' || typeof m.id !== 'string' || !UUID.test(m.id)) return
      if (!m.text.trim() || m.text.length > MAX_SEND) return
      act({ t: 'send', tabId: m.tabId, text: m.text, id: m.id })
      break
    case 'stop':
      if (isId(m.tabId)) act({ t: 'stop', tabId: m.tabId })
      break
    case 'respond': {
      const response = cleanResponse(m.response)
      if (isId(m.tabId) && isId(m.requestId) && response) act({ t: 'respond', tabId: m.tabId, requestId: m.requestId, response })
      break
    }
    case 'project':
      if (isId(m.projectId)) act({ t: 'project', projectId: m.projectId })
      break
    case 'open-saved':
      if (isId(m.ref) && isId(m.sessionId)) act({ t: 'open-saved', ref: m.ref, sessionId: m.sessionId })
      break
    case 'new-chat':
      if (isId(m.ref) && isId(m.projectId)) act({ t: 'new-chat', ref: m.ref, projectId: m.projectId })
      break
    case 'set-model':
      // Which models there are is the window's to say: it only takes one from its own list.
      if (isId(m.tabId) && typeof m.model === 'string' && m.model.length <= 100) act({ t: 'set-model', tabId: m.tabId, model: m.model })
      break
    case 'set-effort':
      if (isId(m.tabId) && (m.effort === null || EFFORTS.includes(m.effort))) act({ t: 'set-effort', tabId: m.tabId, effort: m.effort })
      break
  }
}

async function removeDevice(id: string): Promise<void> {
  const s = sessions.get(id)
  if (s) {
    post(s, { t: 'revoked' })
    await s.chain
  }
  endSession(id)
  cfg.devices = cfg.devices.filter((d) => d.id !== id)
  save()
  sync()
}

// ---------- Start and stop ----------

export function setupRemote(d: Deps): void {
  deps = d
  cfg = load()

  ipcMain.handle('remote:status', () => status())
  ipcMain.handle('remote:enable', (_e, on: boolean) => {
    cfg.enabled = on === true
    if (!cfg.enabled && pairing) {
      clearTimeout(pairing.timer)
      pairing = null
    }
    save()
    sync()
    return status()
  })
  ipcMain.handle('remote:pair', () => startPairing())
  ipcMain.handle('remote:pairCancel', () => {
    cancelPairing()
    return status()
  })
  ipcMain.handle('remote:remove', async (_e, id: string) => {
    await removeDevice(id)
    return status()
  })
  ipcMain.handle('remote:watching', () => watched())

  // What a window shows of a chat, for the phones that have it open (or the one named).
  ipcMain.on('remote:push', (_e, msg: ToPhone, to?: string) => {
    if (msg.t !== 'chat' && msg.t !== 'live' && msg.t !== 'earlier' && msg.t !== 'gone') return
    let closed = false
    for (const s of sessions.values()) {
      if (s.watching !== msg.tabId || (to && s.device.id !== to)) continue
      post(s, msg)
      if (msg.t === 'gone') {
        s.watching = null
        closed = true
      }
    }
    if (closed) watchingChanged()
  })
  // Things that aren't about one open chat: project icons, a project's saved chats, a chat just opened.
  ipcMain.on('remote:tell', (_e, msg: ToPhone, to?: string) => {
    if (msg.t !== 'icons' && msg.t !== 'project' && msg.t !== 'opened') return
    for (const s of sessions.values()) if (!to || s.device.id === to) post(s, msg)
  })
  ipcMain.on('remote:list', (_e, list: RemoteList) => {
    lastList = list
    for (const s of sessions.values()) post(s, { t: 'list', list })
  })

  // Waking from sleep leaves a connection that looks open and isn't: start a new one.
  powerMonitor.on('resume', () => {
    if (!ws) return
    attempts = 0
    ws.close()
  })
  sync()
}

export function closeRemote(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    save()
  }
  closing = true
  disconnect()
}

/** Phones connected right now */
export function remotePhones(): number {
  return sessions.size
}
