// The relay behind remote.loom.baby. Each Loom install has a room; Loom on the PC and the phones
// linked to it connect to that room, and the room passes their messages along. It can't read
// them: Loom and each phone seal everything with a key the relay never sees (src/shared/remote.ts).
//
// Rooms are Durable Objects using the hibernation API: a room with nothing to pass along is put
// away while its connections stay open, so idle phones and PCs cost nothing.

import { DurableObject } from 'cloudflare:workers'

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ASSETS: Fetcher
}

const ID = /^[A-Za-z0-9_-]{22}$/
/** Phones that can be connected to one room at a time */
const MAX_PHONES = 8
/** The largest message passed along, in characters */
const MAX_MESSAGE = 4 * 1024 * 1024

/** A PC that hasn't answered a ping for this long is taken to be asleep or gone */
const PC_QUIET_MS = 75_000
/** Connections that say they are the PC and haven't shown it yet */
const MAX_UNPROVEN = 3

type Who = { role: 'pc'; ok: boolean; since: number } | { role: 'phone'; device: string }

type Frame = { t?: unknown; key?: unknown; d?: unknown; to?: unknown; p?: unknown; x?: unknown }

/** The parts of a message that are passed along: the sealed data, a pairing id, a plain word. */
function passed(frame: Frame): { d?: string; p?: string; x?: string } {
  const out: { d?: string; p?: string; x?: string } = {}
  if (typeof frame.d === 'string') out.d = frame.d
  if (typeof frame.p === 'string' && ID.test(frame.p)) out.p = frame.p
  if (typeof frame.x === 'string' && frame.x.length <= 20) out.x = frame.x
  return out
}

function send(ws: WebSocket, value: unknown): void {
  try {
    ws.send(typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Closing already: nothing to tell it.
  }
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keep-alives are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private who(ws: WebSocket): Who {
    return ws.deserializeAttachment() as Who
  }

  /** The PC's connection, once it has shown it is this room's PC */
  private pcs(): WebSocket[] {
    return this.ctx.getWebSockets('pc').filter((ws) => {
      const who = this.who(ws)
      return who.role === 'pc' && who.ok
    })
  }

  /**
   * Loom pings every half minute, and those pings are answered without waking the room. A PC
   * that went to sleep stops pinging while its connection still looks open: when a phone turns
   * up or speaks, such a connection is closed, so the phone is told the PC is away.
   */
  private dropQuietPc(): void {
    for (const ws of this.pcs()) {
      const who = this.who(ws)
      const last = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? (who.role === 'pc' ? who.since : 0)
      if (Date.now() - last <= PC_QUIET_MS) continue
      ws.serializeAttachment({ role: 'pc', ok: false, since: 0 } satisfies Who)
      ws.close(4001, 'No ping from the PC')
      if (!this.pcs().length) for (const phone of this.phones()) send(phone, { t: 'pc', on: false })
    }
  }

  private phones(): WebSocket[] {
    return this.ctx.getWebSockets('phone')
  }

  private deviceOf(ws: WebSocket): string {
    const who = this.who(ws)
    return who.role === 'phone' ? who.device : ''
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const device = url.searchParams.get('device') ?? ''
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    if (role === 'pc') {
      // Nothing reaches it, and no phone hears of it, until it proves it is this room's PC.
      const unproven = this.ctx.getWebSockets('pc').filter((ws) => !this.pcs().includes(ws))
      for (const old of unproven.slice(0, Math.max(0, unproven.length - MAX_UNPROVEN + 1))) old.close(4003, 'Sign in first')
      this.ctx.acceptWebSocket(server, ['pc'])
      server.serializeAttachment({ role: 'pc', ok: false, since: Date.now() } satisfies Who)
    } else {
      this.dropQuietPc()
      const others = new Set(this.phones().map((ws) => this.deviceOf(ws)))
      others.delete(device)
      if (others.size >= MAX_PHONES) return new Response('Too many phones are connected', { status: 429 })
      // The same phone again (a reload, or waking from sleep) takes the place of its old connection.
      for (const old of this.ctx.getWebSockets(`d:${device}`)) old.close(4000, 'Replaced by a newer connection')
      this.ctx.acceptWebSocket(server, ['phone', `d:${device}`])
      server.serializeAttachment({ role: 'phone', device } satisfies Who)
      send(server, { t: 'pc', on: this.pcs().length > 0 })
      for (const pc of this.pcs()) send(pc, { t: 'join', from: device })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    if (message.length > MAX_MESSAGE) return ws.close(1009, 'Message too big')
    let frame: Frame
    try {
      frame = JSON.parse(message) as Frame
    } catch {
      return
    }
    const who = this.who(ws)
    if (who.role === 'pc') {
      if (!who.ok) return this.signIn(ws, frame)
      if (typeof frame.to !== 'string' || !ID.test(frame.to)) return
      const out = JSON.stringify(passed(frame))
      for (const phone of this.ctx.getWebSockets(`d:${frame.to}`)) send(phone, out)
      return
    }
    if (typeof frame.d !== 'string') return
    this.dropQuietPc()
    const out = JSON.stringify({ from: who.device, ...passed(frame) })
    for (const pc of this.pcs()) send(pc, out)
  }

  /**
   * The PC's first message: its room key. The first PC to sign in to a room owns it; after that
   * only the same key gets in, so nobody else can take the PC's place and cut it off.
   */
  private async signIn(ws: WebSocket, frame: Frame): Promise<void> {
    if (frame.t !== 'auth' || typeof frame.key !== 'string' || frame.key.length < 40 || frame.key.length > 100) {
      return ws.close(4003, 'Sign in first')
    }
    const hash = await sha256(frame.key)
    const owner = await this.ctx.storage.get<string>('pc')
    if (owner && owner !== hash) {
      send(ws, { t: 'denied', reason: 'This room belongs to another PC' })
      return ws.close(4003, 'This room belongs to another PC')
    }
    if (!owner) await this.ctx.storage.put('pc', hash)
    for (const old of this.pcs()) old.close(4000, 'Replaced by a newer connection')
    ws.serializeAttachment({ role: 'pc', ok: true, since: Date.now() } satisfies Who)
    send(ws, { t: 'phones', ids: [...new Set(this.phones().map((p) => this.deviceOf(p)))] })
    for (const phone of this.phones()) send(phone, { t: 'pc', on: true })
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // Closed already.
    }
    this.gone(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws)
  }

  /** Tells the other side that a connection went away, unless a newer one took its place. */
  private gone(ws: WebSocket): void {
    const who = this.who(ws)
    if (who.role === 'pc') {
      if (who.ok && !this.pcs().some((other) => other !== ws)) for (const phone of this.phones()) send(phone, { t: 'pc', on: false })
      return
    }
    if (this.ctx.getWebSockets(`d:${who.device}`).some((other) => other !== ws)) return
    for (const pc of this.pcs()) send(pc, { t: 'leave', from: who.device })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const room = url.pathname.match(/^\/v1\/room\/([A-Za-z0-9_-]{22})$/)?.[1]
    // Anything else is the page's business: its files, or its "not found" page.
    if (!room) return url.pathname.startsWith('/v1/') ? new Response('Not found', { status: 404 }) : env.ASSETS.fetch(request)
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('This address takes WebSocket connections', { status: 426 })
    const role = url.searchParams.get('role')
    const device = url.searchParams.get('device') ?? ''
    if (role !== 'pc' && !(role === 'phone' && ID.test(device))) return new Response('Bad request', { status: 400 })
    // Phones connect from this site's page only. Loom on the PC is no browser and sends no Origin.
    const origin = request.headers.get('Origin')
    if (role === 'phone' ? origin !== url.origin : origin !== null && origin !== url.origin) {
      return new Response('Forbidden', { status: 403 })
    }
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
  }
} satisfies ExportedHandler<Env>
