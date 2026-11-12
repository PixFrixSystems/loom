// Phone access, in a Loom window: what linked phones see of the chats this window shows, and
// what they ask of them. A phone gets exactly what is on screen here (the same steps, the reply
// as it is written, the same questions), and what it sends goes through the same actions as
// Loom's own buttons. The main process carries the messages (src/main/remote.ts).

import { DEFAULT_MODELS, type ChatItem, type ChatTab, type EffortLevel, type ModelOption, type PermissionRequest, type SessionSummary } from '@shared/types'
import type { PhoneAction, RemoteChatState, RemoteChatSummary, RemoteList, ToPhone } from '@shared/remote'
import { projectForPath } from './lib/paths'
import { chatWorking, EMPTY_CHAT, modelName, POPOUT_TAB, useLive, useStore, type ChatRuntime } from './store'

/** Steps a phone gets when it opens a chat, and with each "show earlier" */
const PAGE = 60
/** The most a phone is sent of one step's input, output or diff */
const TEXT_MAX = 6000
const LONG_MAX = 40_000
/** Changes are gathered for this long, then sent together */
const FLUSH_MS = 200
const LIST_MS = 800
/** Saved chats a phone is sent for one project */
const SAVED_PAGE = 40
/** Project icons are sent this many pixels square */
const ICON_PX = 64

function cut(text: string, max: number): string
function cut(text: string | undefined, max: number): string | undefined
function cut(text: string | undefined, max: number): string | undefined {
  if (!text || text.length <= max) return text
  return `${text.slice(0, max)}\n… ${(text.length - max).toLocaleString('en-US')} more characters, cut for the phone`
}

/** A step as a phone gets it: long input and output cut short, full-size images left out. */
function forPhone(item: ChatItem): ChatItem {
  switch (item.kind) {
    case 'tool':
      return {
        ...item,
        detail: cut(item.detail, TEXT_MAX),
        result: cut(item.result, TEXT_MAX),
        diff: item.diff ? { before: cut(item.diff.before, TEXT_MAX), after: cut(item.diff.after, TEXT_MAX) } : undefined
      }
    case 'user':
      return item.previews ? { ...item, previews: item.previews.map((p) => ({ thumb: p.thumb })) } : item
    case 'thinking':
      return { ...item, text: cut(item.text, LONG_MAX) }
    case 'note':
      return { ...item, detail: cut(item.detail, TEXT_MAX) }
    default:
      return item
  }
}

function permissionForPhone(p: PermissionRequest): PermissionRequest {
  return {
    ...p,
    detail: cut(p.detail, TEXT_MAX),
    diff: p.diff ? { before: cut(p.diff.before, TEXT_MAX), after: cut(p.diff.after, TEXT_MAX) } : undefined,
    plan: cut(p.plan, LONG_MAX)
  }
}

/** One chat phones have open: what they hold of it, so only what changed is sent. */
interface Track {
  tabId: string
  /** False until the first whole copy has gone out */
  primed: boolean
  /** The steps phones hold, in order, and each as Loom held it when it was sent */
  order: string[]
  sent: Map<string, ChatItem>
  /** How many older steps Loom has, as last told */
  earlier: number
  state: string
  partial: string
  thinking: string | null
  timer: ReturnType<typeof setTimeout> | null
}

const tracks = new Map<string, Track>()
let watching: string[] = []
let started = false

function chatTab(tabId: string): ChatTab | null {
  const tab = useStore.getState().tabs.find((t) => t.id === tabId)
  return tab?.kind === 'chat' ? tab : null
}

/** The chat tab, when this window is the one showing it. */
function owned(tabId: string): ChatTab | null {
  const tab = chatTab(tabId)
  if (!tab) return null
  if (!POPOUT_TAB && useStore.getState().detached[tabId]) return null
  return tab
}

const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** The models a chat can pick, as the message box lists them. */
function modelChoices(): ModelOption[] {
  const known = useStore.getState().knownModels
  return known.length ? known : DEFAULT_MODELS
}

/** The effort levels a chat's model takes, as the message box works them out. */
function effortChoices(tab: ChatTab, c: ChatRuntime): EffortLevel[] {
  const picked = tab.model ?? ''
  const info = modelChoices().find((m) => m.value === picked || (!!c.activeModel && m.resolved === c.activeModel))
  return info?.efforts ?? ALL_EFFORTS
}

function stateOf(tab: ChatTab, c: ChatRuntime): RemoteChatState {
  return {
    title: tab.title,
    projectId: tab.projectId,
    cwd: tab.cwd,
    status: c.status,
    error: c.error,
    permissions: c.permissions.map(permissionForPhone),
    tasks: c.tasks.map((t) => ({ id: t.id, description: t.description, agentType: t.agentType })),
    startedAt: c.startedAt,
    activity: c.activity ?? null,
    model: modelName(c.activeModel ?? tab.model ?? undefined, useStore.getState().knownModels),
    mode: c.permissionMode ?? tab.permissionMode ?? null,
    modelValue: tab.model ?? '',
    effort: tab.effort ?? null,
    efforts: effortChoices(tab, c),
    defaultEffort: useStore.getState().info?.defaultEffort ?? null
  }
}

/** The whole chat as phones should hold it now, to all of them or to the one named. */
function sendWhole(track: Track, to?: string): void {
  const tab = owned(track.tabId)
  if (!tab) return
  const c = useStore.getState().chats[track.tabId] ?? EMPTY_CHAT
  // Phones that loaded earlier steps keep them: the copy starts where theirs does.
  const first = track.primed && track.order.length ? c.items.findIndex((i) => i.id === track.order[0]) : -1
  const start = first >= 0 ? first : Math.max(0, c.items.length - PAGE)
  const items = c.items.slice(start)
  const state = stateOf(tab, c)
  track.primed = true
  track.order = items.map((i) => i.id)
  track.sent = new Map(items.map((i) => [i.id, i]))
  track.earlier = start
  track.state = JSON.stringify(state)
  window.loom.remotePush({ t: 'chat', tabId: track.tabId, reset: true, items: items.map(forPhone), earlier: start, state }, to)
  sendLive(track, true, to)
}

/** What changed in the chat since phones were last told. */
function sendChanges(track: Track): void {
  if (!track.primed) return
  const tab = owned(track.tabId)
  if (!tab) return
  const c = useStore.getState().chats[track.tabId] ?? EMPTY_CHAT
  const start = track.order.length ? c.items.findIndex((i) => i.id === track.order[0]) : 0
  if (start < 0) return sendWhole(track)
  const items = c.items.slice(start)
  const present = new Set(items.map((i) => i.id))
  const kept = track.order.filter((id) => present.has(id))
  // Steps are only ever added at the end or changed in place. Anything else: send it whole.
  if (items.length < kept.length || kept.some((id, i) => items[i].id !== id)) return sendWhole(track)
  const changed = items.filter((i) => track.sent.get(i.id) !== i)
  const remove = track.order.filter((id) => !present.has(id))
  const state = stateOf(tab, c)
  const stateKey = JSON.stringify(state)
  if (!changed.length && !remove.length && stateKey === track.state && start === track.earlier) return
  const msg: Extract<ToPhone, { t: 'chat' }> = { t: 'chat', tabId: track.tabId, reset: false, items: changed.map(forPhone) }
  if (remove.length) msg.remove = remove
  if (start !== track.earlier) msg.earlier = start
  if (stateKey !== track.state) msg.state = state
  track.order = items.map((i) => i.id)
  track.sent = new Map(items.map((i) => [i.id, i]))
  track.earlier = start
  track.state = stateKey
  window.loom.remotePush(msg)
}

/** The reply being written and the thought in progress: what was added, or all of it. */
function sendLive(track: Track, whole = false, to?: string): void {
  if (!track.primed) return
  const live = useLive.getState()
  const partial = live.partial[track.tabId] ?? ''
  const thought = live.thinking[track.tabId] ?? null
  const msg: Extract<ToPhone, { t: 'live' }> = { t: 'live', tabId: track.tabId }
  if (whole || partial !== track.partial) {
    msg.partial = !whole && track.partial && partial.startsWith(track.partial) ? { add: partial.slice(track.partial.length) } : { set: partial }
  }
  if (whole || (thought?.text ?? null) !== track.thinking) {
    msg.thinking = !thought
      ? null
      : !whole && track.thinking !== null && thought.text.startsWith(track.thinking)
        ? { add: thought.text.slice(track.thinking.length), since: thought.since }
        : { set: cut(thought.text, LONG_MAX), since: thought.since }
  }
  if (!msg.partial && msg.thinking === undefined) return
  track.partial = partial
  track.thinking = thought?.text ?? null
  window.loom.remotePush(msg, to)
}

function flush(track: Track): void {
  if (track.timer) clearTimeout(track.timer)
  track.timer = null
  if (tracks.get(track.tabId) !== track) return
  sendChanges(track)
  sendLive(track)
}

function schedule(track: Track): void {
  track.timer ??= setTimeout(() => flush(track), FLUSH_MS)
}

function newTrack(tabId: string): Track {
  const track: Track = { tabId, primed: false, order: [], sent: new Map(), earlier: 0, state: '', partial: '', thinking: null, timer: null }
  tracks.set(tabId, track)
  return track
}

function drop(track: Track): void {
  if (track.timer) clearTimeout(track.timer)
  tracks.delete(track.tabId)
}

/** A saved chat nobody has looked at since Loom started has its steps on disk: read them first. */
async function withHistory(tabId: string): Promise<void> {
  const s = useStore.getState()
  if (chatTab(tabId)?.sessionId && s.chat(tabId).historyState === 'none') await s.loadHistory(tabId).catch(() => undefined)
}

/**
 * Follows the chats phones have open, for the ones this window shows. `mine` is true when the
 * change came from this window (a tab moved here from another window, or the window just
 * started): the phones already watching are then sent the chat whole.
 */
function reconcile(mine: boolean): void {
  for (const track of [...tracks.values()]) if (!watching.includes(track.tabId) || !owned(track.tabId)) drop(track)
  for (const tabId of watching) {
    if (tracks.has(tabId)) continue
    if (owned(tabId)) {
      const track = newTrack(tabId)
      if (mine) void withHistory(tabId).then(() => tracks.get(tabId) === track && sendWhole(track))
    } else if (!POPOUT_TAB && !chatTab(tabId)) {
      // Closed, in this window or a window of its own: the main window says so.
      window.loom.remotePush({ t: 'gone', tabId })
    }
  }
}

async function open(tabId: string, device: string): Promise<void> {
  if (!owned(tabId)) {
    if (!POPOUT_TAB && !chatTab(tabId)) window.loom.remotePush({ t: 'gone', tabId }, device)
    return
  }
  await withHistory(tabId)
  if (!owned(tabId) || !watching.includes(tabId)) return
  const track = tracks.get(tabId) ?? newTrack(tabId)
  if (track.primed) {
    // Others already have it open: bring them up to date, then give the newcomer all of it.
    flush(track)
    sendWhole(track, device)
  } else {
    sendWhole(track)
  }
}

function act(action: PhoneAction, device: string): void {
  if (action.t === 'project' || action.t === 'open-saved' || action.t === 'new-chat') {
    // Projects and saved chats are the main window's to answer for.
    if (!POPOUT_TAB) void browse(action, device)
    return
  }
  const tab = owned(action.tabId)
  if (!tab) return
  const s = useStore.getState()
  const c = s.chat(tab.id)
  switch (action.t) {
    case 'send':
      if (!c.moving) {
        void s.send(
          tab.id,
          action.text,
          (action.images ?? []).map((image, i) => ({ mediaType: image.mediaType, data: image.data, name: `phone-${i + 1}` })),
          action.id
        )
      }
      break
    case 'stop':
      s.interrupt(tab.id)
      break
    case 'respond':
      if (c.permissions.some((p) => p.requestId === action.requestId)) s.respond(tab.id, action.requestId, action.response)
      break
    // The same as picking in the message box, and only from what it offers.
    case 'set-model':
      if (modelChoices().some((m) => m.value === action.model)) s.setModel(tab.id, action.model || null)
      break
    case 'set-effort':
      if (action.effort === null || effortChoices(tab, c).includes(action.effort)) s.setEffort(tab.id, action.effort)
      break
    case 'more': {
      const track = tracks.get(tab.id)
      if (!track?.primed || track.order[0] !== action.before) return
      const at = c.items.findIndex((i) => i.id === action.before)
      if (at <= 0) return
      const from = Math.max(0, at - PAGE)
      const older = c.items.slice(from, at)
      track.order = [...older.map((i) => i.id), ...track.order]
      for (const i of older) track.sent.set(i.id, i)
      track.earlier = from
      window.loom.remotePush({ t: 'earlier', tabId: tab.id, items: older.map(forPhone), earlier: from })
      break
    }
  }
}

// ---------- Projects and their saved chats (main window only) ----------

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A project's saved chats that aren't open in a tab, newest first. */
function savedChats(projectId: string): SessionSummary[] {
  const s = useStore.getState()
  const open = new Set(s.tabs.flatMap((t) => (t.kind === 'chat' && t.sessionId ? [t.sessionId] : [])))
  return s.sessions
    .filter((x) => !open.has(x.sessionId) && projectForPath(s.projects, x.cwd)?.id === projectId)
    .sort((a, b) => b.lastModified - a.lastModified)
}

/** What a phone asks of the projects: a project's saved chats, one of them opened, a new chat. */
async function browse(action: Extract<PhoneAction, { t: 'project' | 'open-saved' | 'new-chat' }>, device: string): Promise<void> {
  const s = useStore.getState()
  switch (action.t) {
    case 'project': {
      await s.refreshSessions(false)
      const all = savedChats(action.projectId)
      window.loom.remoteTell(
        {
          t: 'project',
          projectId: action.projectId,
          saved: all.slice(0, SAVED_PAGE).map((x) => ({ sessionId: x.sessionId, title: oneLine(x.title).slice(0, 120) || 'Untitled chat', lastAt: x.lastModified })),
          more: Math.max(0, all.length - SAVED_PAGE)
        },
        device
      )
      break
    }
    case 'open-saved': {
      // Opened as a tab in Loom, the same as clicking it in the sidebar.
      const session = s.sessions.find((x) => x.sessionId === action.sessionId)
      if (session) s.openSession(session)
      const tab = useStore.getState().tabs.find((t) => t.kind === 'chat' && t.sessionId === action.sessionId)
      window.loom.remoteTell({ t: 'opened', ref: action.ref, tabId: tab?.id ?? null }, device)
      break
    }
    case 'new-chat': {
      const before = new Set(s.tabs.map((t) => t.id))
      if (s.projects.some((p) => p.id === action.projectId)) s.newChat(action.projectId)
      const tab = useStore.getState().tabs.find((t) => t.kind === 'chat' && !before.has(t.id))
      window.loom.remoteTell({ t: 'opened', ref: action.ref, tabId: tab?.id ?? null }, device)
      break
    }
  }
}

// Each project's own icon (its site's favicon, or the one picked for it), made small for the phone.
const smallIcons = new Map<string, Promise<string | null>>()

function smallIcon(url: string): Promise<string | null> {
  let made = smallIcons.get(url)
  if (!made) {
    made = (async () => {
      try {
        const img = new Image()
        img.src = url
        await img.decode()
        const w = img.naturalWidth || ICON_PX
        const h = img.naturalHeight || ICON_PX
        const scale = Math.min(1, ICON_PX / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/webp', 0.9)
      } catch {
        return null
      }
    })()
    smallIcons.set(url, made)
  }
  return made
}

let iconsTimer: ReturnType<typeof setTimeout> | null = null
let lastIcons = ''

async function sendIcons(always = false): Promise<void> {
  if (iconsTimer) clearTimeout(iconsTimer)
  iconsTimer = null
  const s = useStore.getState()
  const made = await Promise.all(s.projects.map(async (p) => [p.id, s.icons[p.id] ? await smallIcon(s.icons[p.id]!) : null] as const))
  const icons: Record<string, string> = {}
  for (const [id, url] of made) if (url) icons[id] = url
  const key = Object.entries(icons)
    .map(([id, url]) => `${id}:${url.length}:${url.slice(-16)}`)
    .join('|')
  if (!always && key === lastIcons) return
  lastIcons = key
  window.loom.remoteTell({ t: 'icons', icons })
}

// ---------- The list of projects and open chats (main window only) ----------

let listTimer: ReturnType<typeof setTimeout> | null = null
let lastList = ''

function listNow(): RemoteList {
  const s = useStore.getState()
  const chats: RemoteChatSummary[] = s.tabs
    .filter((t): t is ChatTab => t.kind === 'chat')
    .map((tab) => {
      const c = s.chats[tab.id]
      const said = c?.items.findLast((i) => i.kind === 'assistant' || i.kind === 'user')
      const lastTs = c?.items.at(-1)?.ts
      const saved = tab.sessionId ? s.sessions.find((x) => x.sessionId === tab.sessionId) : undefined
      return {
        tabId: tab.id,
        projectId: tab.projectId,
        title: tab.title,
        status: c?.status ?? 'idle',
        working: chatWorking(c),
        needsYou: !!c?.permissions.length,
        unread: !!c?.unread,
        lastAt: lastTs ? Date.parse(lastTs) : saved?.lastModified,
        preview: said && 'text' in said ? oneLine(said.text).slice(0, 140) || undefined : undefined
      }
    })
  // Every project, in the sidebar's order: each group's, then the ones in no group.
  const open = new Set(s.tabs.flatMap((t) => (t.kind === 'chat' && t.sessionId ? [t.sessionId] : [])))
  const history = new Map<string, { saved: number; last: number }>()
  for (const x of s.sessions) {
    const p = projectForPath(s.projects, x.cwd)
    if (!p) continue
    const h = history.get(p.id) ?? { saved: 0, last: 0 }
    if (!open.has(x.sessionId)) h.saved++
    h.last = Math.max(h.last, x.lastModified)
    history.set(p.id, h)
  }
  const grouped = (groupId: string | null | undefined): boolean => !!groupId && s.groups.some((g) => g.id === groupId)
  const ordered = [...s.groups.flatMap((g) => s.projects.filter((p) => p.groupId === g.id)), ...s.projects.filter((p) => !grouped(p.groupId))]
  return {
    groups: s.groups.filter((g) => ordered.some((p) => p.groupId === g.id)).map((g) => ({ id: g.id, name: g.name })),
    projects: ordered.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      groupId: grouped(p.groupId) ? p.groupId : null,
      saved: history.get(p.id)?.saved ?? 0,
      lastAt: history.get(p.id)?.last || undefined
    })),
    chats,
    models: modelChoices().map((m) => ({ value: m.value, label: m.label, description: m.description })),
    // The meters, without the account they belong to.
    usage: s.usage ? { ...s.usage, email: undefined } : null
  }
}

function sendList(always = false): void {
  if (listTimer) clearTimeout(listTimer)
  listTimer = null
  const list = listNow()
  const key = JSON.stringify(list)
  if (!always && key === lastList) return
  lastList = key
  window.loom.remoteList(list)
}

function phonesConnected(): boolean {
  return !!useStore.getState().remote?.devices.some((d) => d.connected)
}

// ---------- A phone asking to be linked (main window only) ----------

let asking: string | null = null
const answered = new Set<string>()

/**
 * A phone scanned the code: Loom asks here, on the PC, before it is let in. The dialog names the
 * phone and shows the digits its screen shows, so a phone that isn't yours is easy to tell.
 */
function askAboutLinks(): void {
  const s = useStore.getState()
  const waiting = s.remote?.requests ?? []
  // The request on screen went away (its code ran out, or was cancelled): take the question down.
  if (asking && !waiting.some((r) => r.id === asking)) {
    const open = s.confirm
    if (open?.linkRequest === asking) {
      useStore.setState({ confirm: null })
      open.resolve(open.cancel)
    }
    return
  }
  const next = waiting.find((r) => !answered.has(r.id))
  if (asking || !next) return
  asking = next.id
  void s
    .ask({
      title: `Link ${next.name} to Loom?`,
      body: 'It scanned the code on this PC. Check that its screen shows these digits. A linked phone can read your chats, send messages and approve what Claude asks to run.',
      code: next.code,
      linkRequest: next.id,
      choices: [
        { id: 'link', label: 'Link this phone', kind: 'primary' },
        { id: 'refuse', label: 'Refuse', kind: 'ghost' }
      ],
      cancel: 'refuse'
    })
    .then(async (choice) => {
      answered.add(next.id)
      const remote = await window.loom.remoteAnswerLink(next.id, choice === 'link')
      asking = null
      useStore.setState({ remote })
    })
}

// ---------- Start ----------

export function startRemoteAgent(): void {
  if (started) return
  started = true

  window.loom.onRemoteWatching((tabIds) => {
    watching = tabIds
    reconcile(false)
  })
  window.loom.onRemoteOpen((tabId, device) => void open(tabId, device))
  window.loom.onRemoteAct((action, device) => act(action, device))

  useStore.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.detached !== prev.detached) reconcile(true)
    for (const track of tracks.values()) {
      if (s.chats[track.tabId] !== prev.chats[track.tabId] || s.tabs !== prev.tabs) schedule(track)
    }
    if (POPOUT_TAB || !phonesConnected()) return
    if (
      s.tabs !== prev.tabs ||
      s.chats !== prev.chats ||
      s.projects !== prev.projects ||
      s.groups !== prev.groups ||
      s.sessions !== prev.sessions ||
      s.usage !== prev.usage ||
      s.knownModels !== prev.knownModels
    ) {
      listTimer ??= setTimeout(() => sendList(), LIST_MS)
    }
    // Icons arrive one by one as Loom finds them: wait for the burst to end.
    if (s.icons !== prev.icons) iconsTimer ??= setTimeout(() => void sendIcons(), 1500)
  })
  useLive.subscribe((l, prev) => {
    for (const track of tracks.values()) {
      if (l.partial[track.tabId] !== prev.partial[track.tabId] || l.thinking[track.tabId] !== prev.thinking[track.tabId]) schedule(track)
    }
  })

  void window.loom.remoteWatching().then((tabIds) => {
    watching = tabIds
    reconcile(true)
  })

  if (POPOUT_TAB) return
  useStore.subscribe((s, prev) => {
    if (s.remote !== prev.remote) askAboutLinks()
  })
  window.loom.onRemoteListRequest(() => {
    sendList(true)
    void sendIcons(true)
  })
  window.loom.onRemoteStatus((remote) => useStore.setState({ remote }))
  void window.loom.remoteStatus().then((remote) => useStore.setState({ remote }))
}
