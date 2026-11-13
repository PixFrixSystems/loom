// The phone's side of the link to Loom on the PC: linking by QR code, the connection through
// the relay, and the key that seals everything (src/shared/remote.ts explains the scheme).
//
// The key lives in this browser's IndexedDB as a key the page can use but never read back, so
// nothing on the page, not even this code, can copy it out.

import {
  aesKey,
  checkCode,
  deviceKeyBytes,
  keyPair,
  pairingId,
  PAIRING_MS,
  pairingKey,
  parsePairingHash,
  publicKey,
  randomId,
  REMOTE_EXTERNAL_AGENTS,
  REMOTE_VERSION,
  seal,
  sealContext,
  unseal,
  type Envelope,
  type FromPhone,
  type Hi,
  type PairDown,
  type PairUp,
  type RelayData,
  type RelayNotice,
  type ToPhone
} from '@shared/remote'

export interface Link {
  room: string
  device: string
  key: CryptoKey
  /** The PC's name, as it gave it when linking */
  pc: string
}

export type Conn =
  /** Reaching the relay */
  | 'connecting'
  /** The relay answers, Loom on the PC doesn't */
  | 'pc-offline'
  | 'online'
  /** This page is open in another tab, which has the connection */
  | 'elsewhere'
  /** Loom no longer knows this phone */
  | 'unknown'

export type PairError = 'expired' | 'full' | 'version' | 'timeout' | 'bad-link' | 'refused'

interface Handlers {
  conn: (conn: Conn) => void
  message: (m: ToPhone) => void
  /** Loom removed this phone: the link is gone from this browser too */
  revoked: () => void
}

// ---------- The saved link ----------

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('loom-remote', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('link')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function store<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(d.transaction('link', mode).objectStore('link'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    d.close()
  }
}

export async function loadLink(): Promise<Link | null> {
  try {
    return ((await store('readonly', (s) => s.get('current'))) as Link | undefined) ?? null
  } catch {
    return null
  }
}

async function saveLink(link: Link): Promise<void> {
  await store('readwrite', (s) => s.put(link, 'current'))
}

export async function forgetLink(): Promise<void> {
  await store('readwrite', (s) => s.delete('current')).catch(() => undefined)
}

// ---------- Linking ----------

function relayUrl(room: string, device: string): string {
  return `${location.origin.replace(/^http/, 'ws')}/v1/room/${room}?role=phone&device=${device}`
}

/** This page running as an app from the Home Screen, with storage of its own, apart from the browser's. */
export function isHomeScreenApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** What Loom's settings call this phone: the device, and its browser or "Home Screen". */
function deviceName(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Windows/.test(ua)
          ? 'Windows PC'
          : /Macintosh/.test(ua)
            ? 'Mac'
            : 'Device'
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  if (isHomeScreenApp()) return `${device}, Home Screen`
  return browser ? `${device}, ${browser}` : device
}

/**
 * Links this phone with the code in the address (the part after #), and saves the link.
 * `waiting` is told when the relay answers but Loom on the PC doesn't yet. `confirm` is told the
 * digits to show while Loom asks, on the PC, whether to let this phone in.
 */
export function pair(hash: string, on: { waiting: (pcOff: boolean) => void; confirm: (digits: string) => void }): Promise<Link> {
  return new Promise((resolve, reject) => {
    const code = parsePairingHash(hash)
    if (!code) return reject('bad-link' satisfies PairError)
    const device = randomId()
    const ws = new WebSocket(relayUrl(code.room, device))
    let done = false
    let sent = false
    /** This phone's key, once Loom's half has arrived: what the digits on both screens come from */
    let raw: Uint8Array<ArrayBuffer> | null = null
    const finish = (err: PairError | null, link?: Link): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(beat)
      ws.close()
      if (link) resolve(link)
      else reject(err)
    }
    let timer = setTimeout(() => finish('timeout'), 30_000)
    // The answer on the PC can take a while: the connection is kept from going quiet meanwhile.
    const beat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    // The pairing's name on the relay and its key both come from the code's secret.
    const keys = pairingId(code.secret).then(async (pairId) => [await pairingKey(code.secret, pairId), await keyPair(), pairId] as const)

    ws.onmessage = async (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return
      let f: RelayNotice | RelayData
      try {
        f = JSON.parse(e.data) as RelayNotice | RelayData
      } catch {
        return
      }
      const [key, own, pairId] = await keys
      if ('t' in f) {
        if (f.t !== 'pc') return
        on.waiting(!f.on)
        if (!f.on || sent) return
        sent = true
        const up: PairUp = { t: 'pair', v: REMOTE_VERSION, pub: await publicKey(own), name: deviceName() }
        ws.send(JSON.stringify({ p: pairId, d: await seal(key, sealContext('pair', pairId, 'up'), up) } satisfies RelayData))
        return
      }
      if (f.x === 'expired') return finish('expired')
      if (f.p !== pairId || typeof f.d !== 'string') return
      const down = await unseal<PairDown>(key, sealContext('pair', pairId, 'down'), f.d)
      if (!down) return
      if (down.t === 'pair-failed') return finish(down.reason)
      try {
        if (down.t === 'confirm') {
          // Loom has the request and is asking on the PC. The code stays good until it runs out.
          raw = await deviceKeyBytes(own, down.pub, code.secret, device)
          on.confirm(await checkCode(raw))
          clearTimeout(timer)
          timer = setTimeout(() => finish('expired'), PAIRING_MS + 15_000)
          return
        }
        // Allowed. The key is the one the digits came from; a Loom from before the question was
        // asked on the PC sends its half only now.
        raw ??= await deviceKeyBytes(own, down.pub, code.secret, device)
        const link: Link = { room: code.room, device, key: await aesKey(raw), pc: String(down.pc).slice(0, 60) }
        await saveLink(link)
        finish(null, link)
      } catch {
        finish('expired')
      }
    }
    ws.onclose = () => finish('timeout')
  })
}

// ---------- The connection ----------

let link: Link | null = null
let handlers: Handlers | null = null
let ws: WebSocket | null = null
let sid: string | null = null
let nonce = ''
let seen = -1
let out = 0
let chain: Promise<void> = Promise.resolve()
let inbox: Promise<void> = Promise.resolve()
let retry: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let beat: ReturnType<typeof setInterval> | null = null
let pongDue: ReturnType<typeof setTimeout> | null = null
let stopped = true
let helloDue: ReturnType<typeof setTimeout> | null = null

function stopBeat(): void {
  if (beat) clearInterval(beat)
  if (pongDue) clearTimeout(pongDue)
  if (helloDue) clearTimeout(helloDue)
  beat = pongDue = helloDue = null
}

async function sayHi(socket: WebSocket): Promise<void> {
  if (!link) return
  sid = null
  nonce = randomId()
  const hi: Hi = { t: 'hi', nonce, can: [REMOTE_EXTERNAL_AGENTS] }
  const d = await seal(link.key, sealContext('device', link.device, 'up'), hi)
  if (socket !== ws || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ d } satisfies RelayData))
  // No answer: the PC is asleep, or Loom is busy starting. Say so, and ask again in a while.
  if (helloDue) clearTimeout(helloDue)
  helloDue = setTimeout(() => {
    if (socket !== ws || sid) return
    handlers?.conn('pc-offline')
    helloDue = setTimeout(() => void sayHi(socket), 15_000)
  }, 6000)
}

async function onFrame(socket: WebSocket, text: string): Promise<void> {
  if (socket !== ws || !link || !handlers) return
  let f: RelayNotice | RelayData
  try {
    f = JSON.parse(text) as RelayNotice | RelayData
  } catch {
    return
  }
  if ('t' in f) {
    if (f.t !== 'pc') return
    if (!f.on) {
      sid = null
      return handlers.conn('pc-offline')
    }
    return sayHi(socket)
  }
  if (f.x === 'unknown') {
    sid = null
    return handlers.conn('unknown')
  }
  if (typeof f.d !== 'string') return
  const env = await unseal<Envelope<ToPhone>>(link.key, sealContext('device', link.device, 'down'), f.d)
  if (!env || typeof env.n !== 'number' || !env.m) return
  if (env.m.t === 'hello') {
    // Only the answer to the hi just sent starts a session: an old hello sent again doesn't.
    if (env.m.nonce !== nonce) return
    if (helloDue) clearTimeout(helloDue)
    helloDue = null
    sid = env.sid
    seen = env.n
    out = 0
    attempts = 0
    handlers.conn('online')
    return handlers.message(env.m)
  }
  if (env.sid !== sid || env.n <= seen) return
  seen = env.n
  if (env.m.t === 'revoked') {
    await forgetLink()
    stop()
    return handlers.revoked()
  }
  handlers.message(env.m)
}

function connect(): void {
  if (!link || stopped) return
  if (retry) clearTimeout(retry)
  retry = null
  const socket = new WebSocket(relayUrl(link.room, link.device))
  ws = socket
  sid = null
  socket.onopen = () => {
    if (socket !== ws) return
    stopBeat()
    beat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send('ping')
      pongDue ??= setTimeout(() => socket.close(), 8000)
    }, 25_000)
  }
  socket.onmessage = (e) => {
    if (socket !== ws || typeof e.data !== 'string') return
    if (e.data === 'pong') {
      if (pongDue) clearTimeout(pongDue)
      pongDue = null
      return
    }
    const text = e.data
    inbox = inbox.then(() => onFrame(socket, text)).catch(() => undefined)
  }
  socket.onclose = (e) => {
    if (socket !== ws) return
    ws = null
    sid = null
    stopBeat()
    if (stopped) return
    // Another tab on this phone took the connection: leave it there until asked back.
    if (e.code === 4000) return handlers?.conn('elsewhere')
    handlers?.conn('connecting')
    const wait = Math.min(15_000, 800 * 2 ** attempts++) + Math.random() * 300
    retry = setTimeout(connect, wait)
  }
}

/** Starts (or restarts) the connection for a link. */
export function start(l: Link, h: Handlers): void {
  stop()
  link = l
  handlers = h
  stopped = false
  attempts = 0
  h.conn('connecting')
  connect()
}

export function stop(): void {
  stopped = true
  if (retry) clearTimeout(retry)
  retry = null
  stopBeat()
  const old = ws
  ws = null
  sid = null
  old?.close()
}

/** Connects again now: the page came back to the front, or the person asked. */
export function reconnect(): void {
  if (!link || !handlers) return
  if (ws && ws.readyState <= WebSocket.OPEN && !stopped) {
    // Looks open: a ping finds out, and closes it if the relay doesn't answer.
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('ping')
      pongDue ??= setTimeout(() => ws?.close(), 4000)
    }
    return
  }
  stopped = false
  attempts = 0
  handlers.conn('connecting')
  connect()
}

/** Sends Loom a message. False when there is no session to send it on. */
export function post(m: FromPhone): boolean {
  const socket = ws
  const l = link
  const session = sid
  if (!socket || !l || !session || socket.readyState !== WebSocket.OPEN) return false
  const env: Envelope<FromPhone> = { sid: session, n: out++, m }
  chain = chain
    .then(async () => {
      const d = await seal(l.key, sealContext('device', l.device, 'up'), env)
      if (socket === ws && sid === session && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ d } satisfies RelayData))
    })
    .catch(() => undefined)
  return true
}
