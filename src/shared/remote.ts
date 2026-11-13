// Phone access: what Loom on the PC and the page at remote.loom.baby say to each other, and the
// encryption around it. Shared by Loom's main process and the phone page, so both sides run the
// same code (Web Crypto, which Node and every current browser have).
//
// The relay in between only passes messages along. It sees which room and which phone a message
// is for, never what it says: everything else is sealed with a key only the PC and that phone hold.
//
// Linking a phone:
//   Loom shows a QR code for remote.loom.baby/#r=<room>&s=<secret>. The part after # never
//   leaves the phone's browser. The secret is good for one phone, for a few minutes, and the
//   name the pairing goes by on the relay is worked out from it, so the code stays short.
//   The phone makes a key pair and sends its public key, sealed with a key made from the secret.
//   Loom answers with its own public key the same way. Each side then works out the phone's key
//   from the two key pairs and the secret, so a relay that swapped keys would get nothing, and a
//   photo of an old QR code is no use once the phone has linked.
//   Scanning is not enough to get in: Loom then asks on the PC whether to link that phone, and
//   both screens show the same four digits, worked out from the phone's key. Someone else who
//   got hold of the code shows up with a name and digits that aren't the ones on your phone.
//
// Each connection:
//   The phone says hi with a random number. Loom answers with that number and a fresh session
//   id. Every message after that carries the session id and a count that only goes up, so a
//   message recorded earlier and sent again is turned away, in either direction.

import type { ChatItem, ChatProvider, ChatStatus, EffortLevel, PermissionMode, PermissionRequest, PermissionResponse, ThreadColor, UsageSnapshot } from './types'

export const REMOTE_VERSION = 1

/** Where the phone page and the relay live */
export const REMOTE_ADDRESS = 'https://remote.loom.baby'

/** Room, device, pairing and session ids: 16 random bytes, base64url */
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** Phones one Loom can have linked */
export const MAX_DEVICES = 8

/** How long a QR code can be used */
export const PAIRING_MS = 5 * 60_000

/**
 * A code's secret, in bytes. It works once, for a few minutes, and a handful of wrong tries
 * withdraw it, so 128 bits is plenty; the shorter link makes a QR code that is easier to scan.
 */
export const SECRET_BYTES = 16

// ---------- What goes through the relay ----------

/**
 * A message as the relay passes it. `d` is sealed. The relay adds `from` on the way to the PC and
 * reads `to` on the way out. `p` names a pairing: `d` is then sealed with the pairing secret's
 * key, not a phone's. `x` is a plain word from the PC to a phone it holds no key for.
 */
export interface RelayData {
  d?: string
  to?: string
  from?: string
  p?: string
  x?: 'unknown' | 'expired'
}

/** What the relay itself tells the PC and the phones */
export type RelayNotice =
  | { t: 'phones'; ids: string[] }
  | { t: 'join'; from: string }
  | { t: 'leave'; from: string }
  | { t: 'pc'; on: boolean }
  | { t: 'denied'; reason: string }

// ---------- Linking ----------

export type PairUp = { t: 'pair'; v: number; pub: string; name: string }
export type PairDown =
  /** Loom has the request and is asking on the PC. The phone can now work out its key and the digits to compare. */
  | { t: 'confirm'; pub: string; pc: string }
  /** Allowed on the PC: the phone is linked. (Loom 0.1.8 sends this straight away, with no confirm before it.) */
  | { t: 'paired'; pub: string; pc: string }
  | { t: 'pair-failed'; reason: 'full' | 'version' | 'refused' }

// ---------- After linking ----------

export interface RemoteGroup {
  id: string
  name: string
}

export interface RemoteProject {
  id: string
  name: string
  color: ThreadColor
  /** The sidebar group it is in */
  groupId: string | null
  /** Saved chats of this project that aren't open in Loom */
  saved: number
  /** When its newest chat last changed (epoch ms) */
  lastAt?: number
}

/** A chat in a project's history that isn't open in Loom */
export interface RemoteSavedChat {
  sessionId: string
  title: string
  lastAt: number
}

export interface RemoteChatSummary {
  tabId: string
  projectId: string | null
  title: string
  status: ChatStatus
  /** Claude, or agents it started, at work */
  working: boolean
  /** Waiting for an answer: an approval, a question or a plan */
  needsYou: boolean
  unread: boolean
  /** When it last changed (epoch ms) */
  lastAt?: number
  /** The start of the last message, either side */
  preview?: string
}

/** A model a chat can be set to */
export interface RemoteModel {
  /** What Loom calls it; '' is the default of the Claude settings */
  value: string
  label: string
  description?: string
}

export interface RemoteList {
  /** Groups and projects, in the sidebar's order */
  groups: RemoteGroup[]
  projects: RemoteProject[]
  /** The chats open in Loom */
  chats: RemoteChatSummary[]
  /** The models this Claude account can pick */
  models: RemoteModel[]
  usage: UsageSnapshot | null
}

export interface RemoteTask {
  id: string
  description: string
  agentType?: string
}

/** A chat's state besides its steps */
export interface RemoteChatState {
  title: string
  provider?: ChatProvider
  agentName?: string
  projectId: string | null
  cwd: string
  status: ChatStatus
  error?: string
  permissions: PermissionRequest[]
  tasks: RemoteTask[]
  /** When the current turn started (epoch ms) */
  startedAt?: number
  activity?: 'compacting' | null
  /** The model in use, by name */
  model?: string
  mode?: PermissionMode | null
  /** The model picked for this chat: a value from the list's models */
  modelValue: string
  /** Model choices when the chat uses a different provider from the shared list */
  models?: RemoteModel[]
  /** The effort picked; null follows the Claude settings */
  effort: EffortLevel | null
  /** The effort levels this chat's model takes; none when it takes no effort setting */
  efforts: EffortLevel[]
  /** What the Claude settings use for effort, when known */
  defaultEffort: EffortLevel | null
}

/** Text that grows: the whole of it, or what was added since the last message */
export interface TextChange {
  set?: string
  add?: string
}

export type ToPhone =
  /** can: what this Loom takes beyond the first version's messages, such as 'images' with a message */
  | { t: 'hello'; nonce: string; pc: string; version: string; can?: string[] }
  | { t: 'list'; list: RemoteList }
  /**
   * A chat's steps. reset: these are its latest steps, replacing whatever the phone has.
   * Otherwise new steps go at the end and changed ones take the place of the step with their id.
   * `earlier` is how many older steps Loom has.
   */
  | { t: 'chat'; tabId: string; reset: boolean; items: ChatItem[]; remove?: string[]; earlier?: number; state?: RemoteChatState }
  /** The reply being written and the thought in progress. A missing field hasn't changed. */
  | { t: 'live'; tabId: string; partial?: TextChange; thinking?: (TextChange & { since: number }) | null }
  /** Steps from before the ones the phone has, and how many are older still */
  | { t: 'earlier'; tabId: string; items: ChatItem[]; earlier: number }
  /** The chat was closed in Loom */
  | { t: 'gone'; tabId: string }
  /** Each project's own icon, small, as a data URL. Projects without one are left out. */
  | { t: 'icons'; icons: Record<string, string> }
  /** A project's saved chats, newest first, and how many more it has */
  | { t: 'project'; projectId: string; saved: RemoteSavedChat[]; more: number }
  /** The answer to open-saved or new-chat: the chat's tab in Loom, or null when it couldn't open */
  | { t: 'opened'; ref: string; tabId: string | null }
  /** This phone was removed in Loom */
  | { t: 'revoked' }

export type PhoneAction =
  | { t: 'more'; tabId: string; before: string }
  /**
   * id: a UUID the phone made, so its own copy of the message and Loom's are the same step.
   * With images the text may be empty. Only a Loom whose hello says it can take 'images' gets them.
   */
  | { t: 'send'; tabId: string; text: string; id: string; images?: RemoteImage[] }
  | { t: 'stop'; tabId: string }
  | { t: 'respond'; tabId: string; requestId: string; response: PermissionResponse }
  /** Asks for a project's saved chats */
  | { t: 'project'; projectId: string }
  /** Opens a saved chat in Loom. ref: the phone's own name for the request, sent back with the answer */
  | { t: 'open-saved'; ref: string; sessionId: string }
  | { t: 'new-chat'; ref: string; projectId: string }
  /** Sets a chat's model, to one of the list's models */
  | { t: 'set-model'; tabId: string; model: string }
  | { t: 'set-effort'; tabId: string; effort: EffortLevel | null }

export type FromPhone = { t: 'list' } | { t: 'open'; tabId: string } | { t: 'close'; tabId: string } | PhoneAction

/** How a phone starts a connection */
export interface Hi {
  t: 'hi'
  nonce: string
}

/** The sealed part of every message after the hi */
export interface Envelope<M> {
  sid: string
  n: number
  m: M
}

/** The longest message a phone may send to a chat */
export const MAX_SEND = 100_000

/** An image sent with a message: the kinds Claude takes, as base64 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export interface RemoteImage {
  mediaType: (typeof IMAGE_TYPES)[number]
  data: string
}

/** Images one message from a phone may carry */
export const MAX_IMAGES = 4

/**
 * The longest one image's base64 may be (about 460 KB of image). A message is sealed and sent as
 * one piece, which comes to about 1.8 characters per byte of image, and the relay passes pieces
 * of up to 4,000,000 characters: four images of this size fit. The phone makes photos smaller
 * before sending.
 */
export const MAX_IMAGE_CHARS = 620_000

// ---------- What Loom's settings show ----------

export interface RemoteDevice {
  id: string
  name: string
  linkedAt: number
  /** When it last connected */
  seenAt?: number
  connected: boolean
}

/** A phone that scanned the code and waits for the PC to allow it */
export interface RemoteLinkRequest {
  /** The phone's device id */
  id: string
  name: string
  /** The four digits its screen shows */
  code: string
}

export interface RemoteStatus {
  enabled: boolean
  /** Loom's connection to the relay */
  relay: 'off' | 'connecting' | 'online' | 'error'
  error?: string
  devices: RemoteDevice[]
  /** A QR code waiting to be scanned */
  pairing: { url: string; expiresAt: number } | null
  /** Phones that scanned it and wait to be allowed */
  requests: RemoteLinkRequest[]
  /** The page to open on the phone */
  address: string
}

// ---------- Encoding ----------

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64u(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** A room, device, pairing or session id */
export function randomId(): string {
  return b64u(randomBytes(16))
}

// ---------- Keys ----------

const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

/** A key pair, as both Node and browsers hand one out */
export interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
}

async function hkdf(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, 256)
  return new Uint8Array(bits)
}

/** An AES-GCM key from 32 raw bytes, which the page that holds it can use but not read back. */
export function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * The name a pairing goes by on the relay: a one-way mix of its secret, so the QR code needn't
 * carry it and the relay learns nothing about the secret from it.
 */
export async function pairingId(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = enc.encode('loom-remote pairing id v1 ')
  const input = new Uint8Array(label.length + secret.length)
  input.set(label)
  input.set(secret, label.length)
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', input)).subarray(0, 16))
}

/** The key the pairing secret gives, for the two linking messages */
export async function pairingKey(secret: Uint8Array<ArrayBuffer>, pairId: string): Promise<CryptoKey> {
  return aesKey(await hkdf(secret, enc.encode(pairId), 'loom-remote pairing v1'))
}

/** A key pair for linking: the private half can't be read out, only used */
export function keyPair(): Promise<KeyPair> {
  return crypto.subtle.generateKey(ECDH, false, ['deriveBits']) as unknown as Promise<KeyPair>
}

export async function publicKey(pair: KeyPair): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
}

/**
 * A phone's key: from our private key and the other side's public key, mixed with the pairing
 * secret and the phone's id. Both sides get the same 32 bytes.
 */
export async function deviceKeyBytes(
  own: KeyPair,
  peerPublic: string,
  secret: Uint8Array<ArrayBuffer>,
  deviceId: string
): Promise<Uint8Array<ArrayBuffer>> {
  const peer = await crypto.subtle.importKey('raw', unb64u(peerPublic), ECDH, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, own.privateKey, 256))
  return hkdf(shared, secret, `loom-remote device v1 ${deviceId}`)
}

/**
 * The four digits a phone and Loom both show while a link waits to be allowed. They come from
 * the phone's key, so they are the same on both screens only for the phone that key belongs to.
 */
export async function checkCode(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = await hkdf(raw, new Uint8Array(0), 'loom-remote check code v1')
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  return String(n % 10_000).padStart(4, '0')
}

/** What a message's seal is tied to: one phone or pairing, one direction */
export function sealContext(scope: 'pair' | 'device', id: string, dir: 'up' | 'down'): string {
  return `loom-remote ${scope} ${id} ${dir}`
}

/** Seals a value: 12 random bytes, then the encrypted JSON, as base64url. */
export async function seal(key: CryptoKey, context: string, value: unknown): Promise<string> {
  const iv = randomBytes(12)
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(JSON.stringify(value)))
  )
  const out = new Uint8Array(12 + data.length)
  out.set(iv)
  out.set(data, 12)
  return b64u(out)
}

/** Opens a sealed value, or null when it wasn't sealed with this key for this context. */
export async function unseal<T>(key: CryptoKey, context: string, sealed: string): Promise<T | null> {
  try {
    const bytes = unb64u(sealed)
    if (bytes.length < 28) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: enc.encode(context) },
      key,
      bytes.subarray(12)
    )
    return JSON.parse(dec.decode(plain)) as T
  } catch {
    return null
  }
}

/** The link a QR code carries. Everything is after the #, which browsers keep to themselves. */
export function pairingUrl(address: string, room: string, secret: Uint8Array): string {
  return `${address}/#r=${room}&s=${b64u(secret)}`
}

export function parsePairingHash(hash: string): { room: string; secret: Uint8Array<ArrayBuffer> } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const room = q.get('r')
  const s = q.get('s')
  if (!room || !s || !ID_PATTERN.test(room) || !ID_PATTERN.test(s)) return null
  try {
    const secret = unb64u(s)
    return secret.length === SECRET_BYTES ? { room, secret } : null
  } catch {
    return null
  }
}
