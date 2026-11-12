// What the phone page knows: whether it is linked, the projects and chats, and the chat that is
// open. Loom on the PC is the source of all of it; this only holds what it was sent.

import { create } from 'zustand'
import type { ChatItem, EffortLevel, PermissionResponse } from '@shared/types'
import type { RemoteChatState, RemoteList, RemoteSavedChat, ToPhone } from '@shared/remote'
import { forgetLink, loadLink, pair, post, reconnect, start, stop, type Conn, type Link, type PairError } from './link'

export interface PhoneChat {
  /** The whole chat has arrived at least once */
  loaded: boolean
  items: ChatItem[]
  /** Older steps Loom still has */
  earlier: number
  askedEarlier: boolean
  state: RemoteChatState | null
  /** The reply being written */
  partial: string
  thinking: { text: string; since: number } | null
  /** Closed in Loom */
  gone: boolean
  /** Messages sent from here that Loom hasn't shown back yet */
  pending: string[]
}

type Phase =
  | { at: 'starting' }
  | { at: 'unlinked'; note?: 'removed' | 'forgotten' }
  | { at: 'linking'; pcOff: boolean }
  | { at: 'link-failed'; why: PairError }
  | { at: 'linked' }

/** The screen on show, from the address: #/ , #/p/<project> , #/c/<chat> */
export type Route = { at: 'home' } | { at: 'project'; id: string } | { at: 'chat'; tabId: string }

interface State {
  phase: Phase
  conn: Conn
  pc: string
  list: RemoteList | null
  route: Route
  chats: Record<string, PhoneChat>
  /** Each project's own icon, by project id */
  icons: Record<string, string>
  /** Saved chats of the projects looked at, and how many more each has */
  saved: Record<string, { chats: RemoteSavedChat[]; more: number }>
  /** A saved chat or a new chat being opened in Loom: what was tapped, and the request's name */
  opening: { what: string; ref: string; failed?: boolean } | null

  boot: () => Promise<void>
  onRoute: () => void
  unlink: () => Promise<void>
  retry: () => void
  send: (tabId: string, text: string) => boolean
  stopChat: (tabId: string) => void
  respond: (tabId: string, requestId: string, response: PermissionResponse) => void
  more: (tabId: string) => void
  setModel: (tabId: string, model: string) => void
  setEffort: (tabId: string, effort: EffortLevel | null) => void
  /** Opens a saved chat in Loom, then shows it */
  openSaved: (sessionId: string) => void
  /** Starts a chat in a project, then shows it */
  newChat: (projectId: string) => void
}

function emptyChat(): PhoneChat {
  return { loaded: false, items: [], earlier: 0, askedEarlier: false, state: null, partial: '', thinking: null, gone: false, pending: [] }
}

function routeFromHash(): Route {
  const chat = location.hash.match(/^#\/c\/([^/?#]{1,80})$/)
  if (chat) return { at: 'chat', tabId: decodeURIComponent(chat[1]) }
  const project = location.hash.match(/^#\/p\/([^/?#]{1,80})$/)
  if (project) return { at: 'project', id: decodeURIComponent(project[1]) }
  return { at: 'home' }
}

const openTab = (r: Route): string | null => (r.at === 'chat' ? r.tabId : null)

/** Goes to a chat, a project, or back to the first screen. */
export function go(to: Route): void {
  location.hash = to.at === 'chat' ? `#/c/${encodeURIComponent(to.tabId)}` : to.at === 'project' ? `#/p/${encodeURIComponent(to.id)}` : '#/'
}

export const useApp = create<State>((set, get) => {
  const patchChat = (tabId: string, fn: (c: PhoneChat) => Partial<PhoneChat>): void =>
    set((s) => {
      const cur = s.chats[tabId] ?? emptyChat()
      return { chats: { ...s.chats, [tabId]: { ...cur, ...fn(cur) } } }
    })

  /** Asks Loom for what the screen on show needs. */
  const ask = (r: Route): void => {
    if (r.at === 'chat') post({ t: 'open', tabId: r.tabId })
    else if (r.at === 'project') post({ t: 'project', projectId: r.id })
  }

  const onMessage = (m: ToPhone): void => {
    switch (m.t) {
      case 'hello':
        set({ pc: m.pc, opening: null })
        post({ t: 'list' })
        // Back after a gap: whatever was on screen is asked for again, whole.
        ask(get().route)
        break
      case 'list': {
        const before = get().list
        set({ list: m.list })
        // A chat opened or closed in Loom changes which of a project's chats count as saved.
        const r = get().route
        if (r.at === 'project' && before?.projects.find((p) => p.id === r.id)?.saved !== m.list.projects.find((p) => p.id === r.id)?.saved) ask(r)
        break
      }
      case 'icons':
        set({ icons: m.icons })
        break
      case 'project':
        set((s) => ({ saved: { ...s.saved, [m.projectId]: { chats: m.saved, more: m.more } } }))
        break
      case 'opened': {
        const opening = get().opening
        if (!opening || opening.ref !== m.ref) break
        if (!m.tabId) return set({ opening: { ...opening, failed: true } })
        set({ opening: null })
        go({ at: 'chat', tabId: m.tabId })
        break
      }
      case 'chat':
        patchChat(m.tabId, (c) => {
          let items: ChatItem[]
          if (m.reset) {
            items = m.items
          } else {
            const gone = new Set(m.remove ?? [])
            items = gone.size ? c.items.filter((i) => !gone.has(i.id)) : [...c.items]
            for (const item of m.items) {
              const at = items.findIndex((i) => i.id === item.id)
              if (at >= 0) items[at] = item
              else items.push(item)
            }
          }
          const have = new Set(items.map((i) => i.id))
          return {
            loaded: c.loaded || m.reset,
            gone: false,
            items,
            earlier: m.earlier ?? c.earlier,
            askedEarlier: m.reset ? false : c.askedEarlier,
            state: m.state ?? c.state,
            pending: c.pending.filter((id) => !have.has(id))
          }
        })
        break
      case 'live':
        patchChat(m.tabId, (c) => {
          const patch: Partial<PhoneChat> = {}
          if (m.partial) patch.partial = m.partial.set ?? c.partial + (m.partial.add ?? '')
          if (m.thinking === null) patch.thinking = null
          else if (m.thinking) patch.thinking = { text: m.thinking.set ?? (c.thinking?.text ?? '') + (m.thinking.add ?? ''), since: m.thinking.since }
          return patch
        })
        break
      case 'earlier':
        patchChat(m.tabId, (c) => {
          const have = new Set(c.items.map((i) => i.id))
          return { items: [...m.items.filter((i) => !have.has(i.id)), ...c.items], earlier: m.earlier, askedEarlier: false }
        })
        break
      case 'gone':
        patchChat(m.tabId, () => ({ gone: true, loaded: true }))
        break
    }
  }

  const cleared = { list: null, chats: {}, icons: {}, saved: {}, opening: null, route: { at: 'home' } as Route }

  const connect = (link: Link): void => {
    set({ phase: { at: 'linked' }, pc: link.pc })
    start(link, {
      conn: (conn) => set({ conn }),
      message: onMessage,
      revoked: () => set({ ...cleared, phase: { at: 'unlinked', note: 'removed' } })
    })
  }

  /** Asks Loom to open something, and remembers what, so the row tapped can say it is opening. */
  const request = (what: string, make: (ref: string) => Parameters<typeof post>[0]): void => {
    if (get().opening && !get().opening?.failed) return
    const ref = crypto.randomUUID()
    if (post(make(ref))) set({ opening: { what, ref } })
  }

  return {
    phase: { at: 'starting' },
    conn: 'connecting',
    pc: '',
    list: null,
    route: { at: 'home' },
    chats: {},
    icons: {},
    saved: {},
    opening: null,

    boot: async () => {
      // A link from Loom's QR code: use it, and take the secret out of the address at once.
      if (/[#&]s=/.test(location.hash)) {
        const hash = location.hash
        history.replaceState(null, '', location.pathname)
        stop()
        set({ ...cleared, phase: { at: 'linking', pcOff: false } })
        try {
          const link = await pair(hash, (pcOff) => set({ phase: { at: 'linking', pcOff } }))
          connect(link)
        } catch (why) {
          set({ phase: { at: 'link-failed', why: why as PairError } })
        }
        return
      }
      const link = await loadLink()
      if (!link) return set({ phase: { at: 'unlinked' } })
      set({ route: routeFromHash() })
      connect(link)
    },

    onRoute: () => {
      // A code opened in a page that was already showing (pasted, or scanned into the same tab).
      if (/[#&]s=/.test(location.hash)) return void get().boot()
      if (get().phase.at !== 'linked') return
      const next = routeFromHash()
      const prev = get().route
      if (JSON.stringify(next) === JSON.stringify(prev)) return
      const was = openTab(prev)
      if (was && was !== openTab(next)) post({ t: 'close', tabId: was })
      set({ route: next, opening: null })
      // A chat is shown again from what was held, then brought up to date when Loom answers.
      if (next.at === 'chat') patchChat(next.tabId, () => ({ gone: false }))
      ask(next)
    },

    unlink: async () => {
      stop()
      await forgetLink()
      history.replaceState(null, '', location.pathname)
      set({ ...cleared, phase: { at: 'unlinked', note: 'forgotten' } })
    },

    retry: () => reconnect(),

    send: (tabId, text) => {
      const id = crypto.randomUUID()
      if (!post({ t: 'send', tabId, text, id })) return false
      // Shown at once; Loom's own copy of the message, with the same id, takes its place.
      patchChat(tabId, (c) => ({
        items: [...c.items, { kind: 'user', id, text, images: 0, ts: new Date().toISOString() }],
        pending: [...c.pending, id]
      }))
      return true
    },

    stopChat: (tabId) => void post({ t: 'stop', tabId }),

    respond: (tabId, requestId, response) => {
      if (!post({ t: 'respond', tabId, requestId, response })) return
      patchChat(tabId, (c) => (c.state ? { state: { ...c.state, permissions: c.state.permissions.filter((p) => p.requestId !== requestId) } } : {}))
    },

    more: (tabId) => {
      const c = get().chats[tabId]
      if (!c?.items.length || c.askedEarlier || c.earlier <= 0) return
      if (post({ t: 'more', tabId, before: c.items[0].id })) patchChat(tabId, () => ({ askedEarlier: true }))
    },

    // Shown at once; what Loom sends back is what counts.
    setModel: (tabId, model) => {
      if (post({ t: 'set-model', tabId, model })) patchChat(tabId, (c) => (c.state ? { state: { ...c.state, modelValue: model } } : {}))
    },

    setEffort: (tabId, effort) => {
      if (post({ t: 'set-effort', tabId, effort })) patchChat(tabId, (c) => (c.state ? { state: { ...c.state, effort } } : {}))
    },

    openSaved: (sessionId) => request(sessionId, (ref) => ({ t: 'open-saved', ref, sessionId })),

    newChat: (projectId) => request(`new:${projectId}`, (ref) => ({ t: 'new-chat', ref, projectId }))
  }
})
