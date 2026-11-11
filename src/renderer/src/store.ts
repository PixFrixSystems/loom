import { create } from 'zustand'
import {
  THREAD_COLORS,
  type BrowserTab,
  type ChatEvent,
  type ChatItem,
  type ChatStatus,
  type ChatTab,
  type ClaudeInfo,
  type ContextInfo,
  type EffortLevel,
  type DiffTab,
  type GitChanges,
  type GitStatus,
  type Group,
  type ImageAttachment,
  type ImagePreview,
  type LayoutNode,
  type LoomSettings,
  type PermissionMode,
  type PermissionRequest,
  type PermissionResponse,
  type PersistedState,
  type Project,
  type RunTarget,
  type ServerInfo,
  type SessionSummary,
  type SlashCommandInfo,
  type Tab,
  type TabSnapshot,
  type UsageSnapshot
} from '@shared/types'
import {
  cleanLayout,
  newPane,
  paneById,
  paneOfTab,
  panesOf,
  presetLayout,
  PRESETS,
  removePane,
  setPaneTab,
  setSizes,
  splitPane as splitLayout,
  type Edge,
  type PresetName
} from './lib/layout'
import { baseName, normPath, projectForPath, thumbnailOf, uid } from './lib/paths'

export interface ChatRuntime {
  items: ChatItem[]
  partial: string
  status: ChatStatus
  error?: string
  permissions: PermissionRequest[]
  historyState: 'none' | 'loading' | 'loaded' | 'error'
  historyTotal: number
  activeModel?: string
  permissionMode: PermissionMode | null
  commands: SlashCommandInfo[]
  unread: boolean
  opened: boolean
  draft: string
  startedAt?: number
  /** How full the context window is */
  context?: ContextInfo
}

/** This window shows one tab that was moved out of the main window. */
export const POPOUT_TAB = new URLSearchParams(location.search).get('popout')

/** Unsaved text of open file tabs, read when a tab moves to another window. FileView keeps it current. */
export const liveDrafts = new Map<string, () => string | null>()

export interface MenuItem {
  label: string
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  submenu?: MenuItem[]
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

type PersistedKeys = keyof PersistedState

interface Store extends PersistedState {
  ready: boolean
  info: ClaudeInfo | null
  chats: Record<string, ChatRuntime>
  terminals: Record<string, { exited: boolean; code?: number; started: boolean }>
  dirtyFiles: Record<string, boolean>
  sessions: SessionSummary[]
  git: Record<string, GitStatus | null>
  /** The Changes panel's view of each project: files, branch, upstream */
  gitChanges: Record<string, GitChanges | null>
  menu: MenuState | null
  icons: Record<string, string | null>
  /** Images chosen for groups, by group id. Groups that borrow a project's icon read `icons`. */
  groupIcons: Record<string, string | null>
  /** What each project can run, by project id. Missing until detected. */
  runTargets: Record<string, RunTarget[]>
  servers: ServerInfo[]
  /** The image viewer, open on one of a message's images */
  viewer: { images: ImagePreview[]; index: number } | null
  layout: LayoutNode
  /** The pane you're working in: the tab bar and new tabs act on it. */
  focusedPane: string
  /** A tab being dragged, so panes can offer to take it */
  draggingTab: string | null
  /** The last pane change came from a click inside it, so the view keeps the focus that click gave */
  pointerFocus: boolean
  /** Tabs showing in windows of their own (main window only) */
  detached: Record<string, true>
  /** Unsaved file text handed over from another window, used once by the file's view */
  fileDrafts: Record<string, string>
  usage: UsageSnapshot | null
  history: string[]
  quickOpen: boolean
  editingProjectId: string | null
  editingGroupId: string | null

  init: () => Promise<void>
  set: (patch: Partial<Store>) => void

  addProject: (path: string, groupId?: string | null) => Project
  pickAndAddProject: (groupId?: string | null) => Promise<void>
  updateProject: (id: string, patch: Partial<Project>) => void
  removeProject: (id: string) => void
  addGroup: (name?: string) => string
  updateGroup: (id: string, patch: Partial<Group>) => void
  deleteGroup: (id: string) => void
  moveProject: (projectId: string, groupId: string | null, beforeProjectId?: string | null) => void

  activate: (tabId: string) => void
  openTab: (tab: Tab) => void
  closeTab: (tabId: string) => void
  moveTab: (tabId: string, toIndex: number) => void
  updateTab: (tabId: string, patch: Partial<Tab>) => void
  newChat: (projectId: string | null) => void
  openSession: (session: SessionSummary) => void
  openFile: (path: string, projectId?: string | null) => void
  newTerminal: (projectId: string | null) => void
  openSettings: () => void

  chat: (tabId: string) => ChatRuntime
  loadHistory: (tabId: string) => Promise<void>
  send: (tabId: string, text: string, images: ImageAttachment[]) => Promise<void>
  interrupt: (tabId: string) => void
  setModel: (tabId: string, model: string | null) => void
  setMode: (tabId: string, mode: PermissionMode) => void
  setEffort: (tabId: string, effort: EffortLevel | null) => void
  setUltracode: (tabId: string, on: boolean) => void
  loadIcon: (projectId: string) => Promise<void>
  loadGroupIcon: (groupId: string) => Promise<void>
  /** Moves a tab into a window of its own; `at` is where on screen, when it was dragged out. */
  popOut: (tabId: string, at?: { x: number; y: number }) => void
  /** A tab's live state, for handing it to another window */
  snapshotOf: (tabId: string) => TabSnapshot | null
  focusPane: (paneId: string, byPointer?: boolean) => void
  /** Fetches the chat's commands and skills before it has started, so the / menu has them all. */
  loadCommands: (tabId: string) => Promise<void>
  /** Remembers a choice made in a chat's message box, so the next chat starts with it. */
  rememberChoice: (patch: Partial<LoomSettings>) => void
  /** The options a new or reopened chat starts with: the ones you picked last. */
  chatDefaults: () => Pick<ChatTab, 'model' | 'permissionMode' | 'effort' | 'ultracode'>
  /** Opens a project's site in a browser tab, beside what you're working on. */
  openPreview: (projectId: string | null, url?: string, beside?: boolean) => void
  /** Adds a pane beside one (the focused one by default) showing the tab, or the last tab not on screen. */
  splitPane: (edge: Edge, tabId?: string | null, paneId?: string) => void
  /** Shows a tab in a pane; if it was showing elsewhere, the two swap. */
  moveTabToPane: (tabId: string, paneId: string) => void
  closePane: (paneId?: string) => void
  applyPreset: (name: PresetName) => void
  resizeSplit: (splitId: string, sizes: number[]) => void
  loadRunTargets: (projectId: string) => Promise<RunTarget[]>
  /** Starts the given target, or the project's usual one. */
  runProject: (projectId: string, targetId?: string) => Promise<void>
  stopServer: (serverId: string) => void
  restartServer: (serverId: string) => void
  dismissServer: (serverId: string) => void
  showServerOutput: (serverId: string) => void
  refreshUsage: (force?: boolean) => Promise<void>
  respond: (tabId: string, requestId: string, response: PermissionResponse) => void
  setDraft: (tabId: string, draft: string) => void
  handleChatEvent: (tabId: string, event: ChatEvent) => void

  refreshSessions: (force?: boolean) => Promise<void>
  refreshGit: (projectId: string) => Promise<void>
  refreshChanges: (projectId: string) => Promise<void>
  /** A file's changes in a tab: uncommitted ones, or the ones made in a commit. */
  openDiff: (projectId: string | null, path: string, commit?: string, commitLabel?: string) => void
  showMenu: (e: { clientX: number; clientY: number }, items: MenuItem[]) => void
}

export function newChatRuntime(): ChatRuntime {
  return {
    items: [],
    partial: '',
    status: 'idle',
    permissions: [],
    historyState: 'none',
    historyTotal: 0,
    permissionMode: null,
    commands: [],
    unread: false,
    opened: false,
    draft: ''
  }
}

const PERSISTED: PersistedKeys[] = [
  'version',
  'projects',
  'groups',
  'tabs',
  'activeTabId',
  'layout',
  'focusedPane',
  'settings',
  'sidebarWidth',
  'sidebarOpen',
  'rightPanelOpen',
  'rightPanelWidth',
  'rightPanelView',
  'knownModels'
]

function pickPersisted(s: Store): PersistedState {
  const out: Record<string, unknown> = {}
  for (const k of PERSISTED) out[k] = s[k]
  return out as unknown as PersistedState
}

function nextColor(projects: Project[]): Project['color'] {
  const used = new Map<string, number>()
  for (const p of projects) used.set(p.color, (used.get(p.color) ?? 0) + 1)
  return [...THREAD_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
}

function chatTitleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 44 ? `${one.slice(0, 44)}…` : one || 'New chat'
}

export const useStore = create<Store>((set, get) => {
  const patchChat = (tabId: string, fn: (c: ChatRuntime) => Partial<ChatRuntime>): void => {
    set((s) => {
      const cur = s.chats[tabId] ?? newChatRuntime()
      return { chats: { ...s.chats, [tabId]: { ...cur, ...fn(cur) } } }
    })
  }

  const ensureOpened = async (tab: ChatTab): Promise<void> => {
    const c = get().chat(tab.id)
    if (c.opened) return
    await window.loom.chatOpen(tab.id, {
      cwd: tab.cwd,
      sessionId: tab.sessionId,
      model: tab.model ?? null,
      permissionMode: tab.permissionMode ?? null,
      effort: tab.effort ?? null,
      ultracode: tab.ultracode === true
    })
    patchChat(tab.id, () => ({ opened: true }))
  }

  return {
    version: 1,
    projects: [],
    groups: [],
    tabs: [],
    activeTabId: null,
    settings: {
      claudeSource: 'bundled',
      claudeCustomPath: '',
      shell: 'powershell',
      sendWithCtrlEnter: false,
      defaultPermissionMode: 'default',
      notifyWhenDone: true
    },
    sidebarWidth: 260,
    sidebarOpen: true,
    rightPanelOpen: false,
    rightPanelWidth: 280,
    rightPanelView: 'files',
    knownModels: [],

    ready: false,
    info: null,
    chats: {},
    terminals: {},
    dirtyFiles: {},
    sessions: [],
    git: {},
    gitChanges: {},
    menu: null,
    icons: {},
    groupIcons: {},
    runTargets: {},
    servers: [],
    viewer: null,
    layout: { kind: 'pane', id: 'main', tabId: null },
    focusedPane: 'main',
    draggingTab: null,
    pointerFocus: false,
    detached: {},
    fileDrafts: {},
    usage: null,
    history: [],
    quickOpen: false,
    editingProjectId: null,
    editingGroupId: null,

    init: async () => {
      const [state, info] = await Promise.all([window.loom.loadState(), window.loom.claudeInfo()])
      window.loom.onSnapshotRequest((tabId) => get().snapshotOf(tabId))
      window.loom.onBrowserShortcut((k) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, code: k.code, ctrlKey: true, shiftKey: k.shift, altKey: k.alt, bubbles: true }))
      )
      if (POPOUT_TAB) {
        // A popout: it shows one tab, saves nothing, and sends its changes to the main window.
        window.loom.onChatEvent((tabId, event) => get().handleChatEvent(tabId, event))
        const got = await window.loom.popoutInit()
        if (!got) return
        const { tab, snapshot } = got
        const chat = snapshot?.chat as ChatRuntime | undefined
        set({
          projects: state.projects,
          groups: state.groups,
          settings: state.settings,
          knownModels: state.knownModels,
          tabs: [tab],
          layout: { kind: 'pane', id: 'main', tabId: tab.id },
          focusedPane: 'main',
          activeTabId: tab.id,
          chats: chat ? { [tab.id]: chat } : {},
          dirtyFiles: snapshot?.dirty ? { [tab.id]: true } : {},
          fileDrafts: snapshot?.fileDraft ? { [tab.id]: snapshot.fileDraft } : {},
          info,
          ready: true
        })
        window.loom.popoutReady()
        let sent = tab
        useStore.subscribe((st) => {
          const now = st.tabs[0]
          if (now && now !== sent) {
            sent = now
            window.loom.popoutTab(now)
          }
        })
        if (tab.projectId) {
          void get().loadIcon(tab.projectId)
          void get().loadRunTargets(tab.projectId)
        }
        window.loom.onServers((servers) => set({ servers }))
        void window.loom.serverList().then((servers) => set({ servers }))
        return
      }
      window.loom.onPopoutTab((tab) => set((st) => ({ tabs: st.tabs.map((t) => (t.id === tab.id ? tab : t)) })))
      window.loom.onPopoutReturned((tabId, snapshot) => {
        const st = get()
        if (!st.tabs.some((t) => t.id === tabId)) return
        const detached = { ...st.detached }
        delete detached[tabId]
        const patch: Partial<Store> = { detached }
        if (snapshot) {
          patch.tabs = st.tabs.map((t) => (t.id === tabId ? snapshot.tab : t))
          if (snapshot.chat) patch.chats = { ...st.chats, [tabId]: snapshot.chat as ChatRuntime }
          patch.dirtyFiles = { ...st.dirtyFiles, [tabId]: !!snapshot.dirty }
          if (snapshot.fileDraft) patch.fileDrafts = { ...st.fileDrafts, [tabId]: snapshot.fileDraft }
        }
        set(patch)
        get().activate(tabId)
      })
      window.loom.onMainDo((action, args) => {
        const st = get() as unknown as Record<string, (...a: unknown[]) => void>
        if (['openFile', 'newChat', 'newTerminal', 'openSettings', 'openSession', 'showServerOutput', 'runProject', 'openPreview', 'rememberChoice', 'openDiff'].includes(action)) st[action](...args)
      })
      // Server output tabs belong to servers that stopped when Loom last quit.
      const tabs = state.tabs.filter((t) => t.kind !== 'server')
      const fallback = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : (tabs[0]?.id ?? null)
      let layout = cleanLayout(state.layout ?? { kind: 'pane', id: 'main', tabId: fallback }, new Set(tabs.map((t) => t.id)))
      let focused = paneById(layout, state.focusedPane ?? '') ?? panesOf(layout)[0]
      // A saved layout whose tabs are gone would open empty: show the last tab used instead.
      if (!focused.tabId && fallback && !panesOf(layout).some((p) => p.tabId === fallback)) {
        layout = setPaneTab(layout, focused.id, fallback)
        focused = paneById(layout, focused.id)!
      }
      set({ ...state, tabs, layout, focusedPane: focused.id, activeTabId: focused.tabId, info, ready: true })
      window.loom.onChatEvent((tabId, event) => get().handleChatEvent(tabId, event))
      let last = pickPersisted(get())
      let timer: ReturnType<typeof setTimeout> | null = null
      useStore.subscribe((s) => {
        if (!s.ready) return
        const changed = PERSISTED.some((k) => s[k] !== (last as unknown as Record<string, unknown>)[k])
        if (!changed) return
        last = pickPersisted(s)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => window.loom.saveState(pickPersisted(get())), 250)
      })
      void get().refreshSessions(true)
      for (const p of get().projects) void get().loadIcon(p.id)
      for (const g of get().groups) void get().loadGroupIcon(g.id)
      for (const p of get().projects) void get().loadRunTargets(p.id)
      window.loom.onServers((servers) => set({ servers }))
      void window.loom.serverList().then((servers) => set({ servers }))
      window.loom.onUsage((usage) => set({ usage }))
      void window.loom.getUsage().then((usage) => usage && set({ usage }))
    },

    set: (patch) => set(patch),

    addProject: (path, groupId = null) => {
      const existing = get().projects.find((p) => normPath(p.path) === normPath(path))
      if (existing) return existing
      const project: Project = { id: uid(), name: baseName(path), path, color: nextColor(get().projects), groupId }
      set((s) => ({ projects: [...s.projects, project] }))
      void get().loadIcon(project.id)
      void get().loadRunTargets(project.id)
      return project
    },
    pickAndAddProject: async (groupId = null) => {
      const path = await window.loom.pickFolder()
      if (path) get().addProject(path, groupId)
    },
    updateProject: (id, patch) => {
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      if ('iconMode' in patch || 'iconPath' in patch || 'path' in patch) void get().loadIcon(id)
      if ('path' in patch) void get().loadRunTargets(id)
    },
    removeProject: (id) => {
      for (const t of get().tabs.filter((t) => t.projectId === id)) get().closeTab(t.id)
      for (const sv of get().servers.filter((x) => x.projectId === id)) void window.loom.serverStop(sv.id)
      set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
    },
    addGroup: (name = 'New group') => {
      const id = uid()
      set((s) => ({ groups: [...s.groups, { id, name }], editingGroupId: id }))
      return id
    },
    updateGroup: (id, patch) => {
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
      if ('iconPath' in patch) void get().loadGroupIcon(id)
    },
    deleteGroup: (id) =>
      set((s) => ({
        groups: s.groups.filter((g) => g.id !== id),
        projects: s.projects.map((p) => (p.groupId === id ? { ...p, groupId: null } : p))
      })),
    moveProject: (projectId, groupId, beforeProjectId) =>
      set((s) => {
        const moving = s.projects.find((p) => p.id === projectId)
        if (!moving) return {}
        const rest = s.projects.filter((p) => p.id !== projectId)
        const updated = { ...moving, groupId }
        const idx = beforeProjectId ? rest.findIndex((p) => p.id === beforeProjectId) : -1
        if (idx >= 0) rest.splice(idx, 0, updated)
        else rest.push(updated)
        return { projects: rest }
      }),

    activate: (tabId) => {
      if (get().detached[tabId]) {
        void window.loom.popoutFocus(tabId)
        return
      }
      set((s) => {
        // Already on screen: go to its pane. Otherwise it takes the place of what the focused pane shows.
        const shown = paneOfTab(s.layout, tabId)
        return {
          layout: shown ? s.layout : setPaneTab(s.layout, s.focusedPane, tabId),
          focusedPane: shown ? shown.id : s.focusedPane,
          activeTabId: tabId,
          pointerFocus: false,
          history: [...s.history.filter((h) => h !== tabId), tabId].slice(-50)
        }
      })
      const c = get().chats[tabId]
      if (c?.unread) patchChat(tabId, () => ({ unread: false }))
      const tab = get().tabs.find((t) => t.id === tabId)
      if (tab?.projectId) void get().refreshGit(tab.projectId)
    },
    openTab: (tab) => {
      set((s) => ({ tabs: [...s.tabs, tab] }))
      get().activate(tab.id)
    },
    closeTab: (tabId) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (s.detached[tabId]) void window.loom.popoutDiscard(tabId)
      if (tab.kind === 'chat') void window.loom.chatClose(tabId)
      if (tab.kind === 'terminal') void window.loom.ptyKill(tabId)
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      // A pane that showed it goes back to the tab used before, like an editor does, among tabs not
      // already on screen; failing that the nearest neighbour; failing that it stays empty.
      const onScreen = new Set(panesOf(s.layout).map((p) => p.tabId))
      const replacement = (): string | null => {
        const back = [...s.history].reverse().find((h) => h !== tabId && !onScreen.has(h) && !s.detached[h] && tabs.some((t) => t.id === h))
        if (back) return back
        const free = tabs.map((t, i) => ({ id: t.id, d: Math.abs(i - idx) })).filter((x) => !onScreen.has(x.id) && !s.detached[x.id])
        return free.sort((a, b) => a.d - b.d)[0]?.id ?? null
      }
      let layout = s.layout
      for (const p of panesOf(layout)) {
        if (p.tabId !== tabId) continue
        const next = replacement()
        layout = setPaneTab(layout, p.id, next)
        onScreen.add(next)
      }
      const activeTabId = paneById(layout, s.focusedPane)?.tabId ?? null
      const chats = { ...s.chats }
      delete chats[tabId]
      const terminals = { ...s.terminals }
      delete terminals[tabId]
      const dirtyFiles = { ...s.dirtyFiles }
      delete dirtyFiles[tabId]
      const detached = { ...s.detached }
      delete detached[tabId]
      const fileDrafts = { ...s.fileDrafts }
      delete fileDrafts[tabId]
      set({ tabs, layout, activeTabId, chats, terminals, dirtyFiles, detached, fileDrafts })
      if (activeTabId) get().activate(activeTabId)
    },
    popOut: (tabId, at) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab || s.detached[tabId] || POPOUT_TAB) return
      // Its pane shows the tab used before it, as when a tab closes.
      const onScreen = new Set(panesOf(s.layout).map((p) => p.tabId))
      const back =
        [...s.history].reverse().find((h) => h !== tabId && !onScreen.has(h) && !s.detached[h] && s.tabs.some((t) => t.id === h)) ??
        s.tabs.find((t) => t.id !== tabId && !onScreen.has(t.id) && !s.detached[t.id])?.id ??
        null
      let layout = s.layout
      for (const p of panesOf(layout)) if (p.tabId === tabId) layout = setPaneTab(layout, p.id, back)
      const activeTabId = paneById(layout, s.focusedPane)?.tabId ?? null
      set({ detached: { ...s.detached, [tabId]: true }, layout, activeTabId })
      void window.loom.popoutOpen(tab, at)
    },
    snapshotOf: (tabId) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return null
      return {
        tab,
        chat: s.chats[tabId],
        dirty: !!s.dirtyFiles[tabId],
        fileDraft: liveDrafts.get(tabId)?.() ?? s.fileDrafts[tabId] ?? null
      }
    },
    moveTab: (tabId, toIndex) =>
      set((s) => {
        const tabs = [...s.tabs]
        const from = tabs.findIndex((t) => t.id === tabId)
        if (from < 0) return {}
        const [t] = tabs.splice(from, 1)
        tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t)
        return { tabs }
      }),
    updateTab: (tabId, patch) =>
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? ({ ...t, ...patch } as Tab) : t)) })),

    newChat: (projectId) => {
      if (POPOUT_TAB) return window.loom.mainDo('newChat', [projectId])
      const project = get().projects.find((p) => p.id === projectId) ?? null
      const cwd = project?.path ?? get().info?.homeDir ?? 'C:\\'
      get().openTab({ id: uid(), kind: 'chat', projectId: project?.id ?? null, sessionId: null, cwd, title: 'New chat', ...get().chatDefaults() })
    },
    openSession: (session) => {
      if (POPOUT_TAB) return window.loom.mainDo('openSession', [session])
      const open = get().tabs.find((t) => t.kind === 'chat' && t.sessionId === session.sessionId)
      if (open) return get().activate(open.id)
      const project = projectForPath(get().projects, session.cwd)
      get().openTab({
        id: uid(),
        kind: 'chat',
        projectId: project?.id ?? null,
        sessionId: session.sessionId,
        cwd: session.cwd,
        title: session.title.length > 60 ? `${session.title.slice(0, 60)}…` : session.title,
        ...get().chatDefaults()
      })
    },
    openFile: (path, projectId) => {
      if (POPOUT_TAB) return window.loom.mainDo('openFile', [path, projectId])
      const open = get().tabs.find((t) => t.kind === 'file' && normPath(t.path) === normPath(path))
      if (open) return get().activate(open.id)
      const project = projectId !== undefined ? get().projects.find((p) => p.id === projectId) : projectForPath(get().projects, path)
      get().openTab({ id: uid(), kind: 'file', projectId: project?.id ?? null, path, title: baseName(path) })
    },
    newTerminal: (projectId) => {
      if (POPOUT_TAB) return window.loom.mainDo('newTerminal', [projectId])
      const project = get().projects.find((p) => p.id === projectId) ?? null
      const cwd = project?.path ?? get().info?.homeDir ?? 'C:\\'
      const count = get().tabs.filter((t) => t.kind === 'terminal' && t.projectId === (project?.id ?? null)).length
      get().openTab({ id: uid(), kind: 'terminal', projectId: project?.id ?? null, cwd, title: count ? `Terminal ${count + 1}` : 'Terminal' })
    },
    openSettings: () => {
      if (POPOUT_TAB) return window.loom.mainDo('openSettings', [])
      const open = get().tabs.find((t) => t.kind === 'settings')
      if (open) return get().activate(open.id)
      get().openTab({ id: uid(), kind: 'settings', projectId: null, title: 'Settings' })
    },

    chat: (tabId) => get().chats[tabId] ?? newChatRuntime(),

    loadHistory: async (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'chat' || !tab.sessionId) return
      const c = get().chat(tabId)
      if (c.historyState === 'loading' || c.historyState === 'loaded') return
      patchChat(tabId, () => ({ historyState: 'loading' }))
      const r = await window.loom.loadHistory(tab.sessionId)
      patchChat(tabId, (cur) => ({
        context: cur.context ?? r.context,
        historyState: r.error ? 'error' : 'loaded',
        historyTotal: r.total,
        error: r.error,
        items: [...r.items, ...cur.items]
      }))
    },

    send: async (tabId, text, images) => {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'chat') return
      const trimmed = text.trim()
      if (!trimmed && !images.length) return
      if (tab.title === 'New chat' && trimmed) get().updateTab(tabId, { title: chatTitleFrom(trimmed) })
      const previews: ImagePreview[] = await Promise.all(
        images.map(async (img) => {
          const full = `data:${img.mediaType};base64,${img.data}`
          return { thumb: await thumbnailOf(full), full }
        })
      )
      patchChat(tabId, (c) => ({
        items: [
          ...c.items,
          { kind: 'user', id: uid(), text: trimmed, images: images.length, previews: previews.length ? previews : undefined, ts: new Date().toISOString() }
        ],
        draft: '',
        error: undefined,
        status: c.status === 'idle' || c.status === 'stopped' || c.status === 'error' ? 'starting' : c.status,
        startedAt: Date.now()
      }))
      try {
        await ensureOpened(tab)
        await window.loom.chatSend(tabId, trimmed, images)
      } catch (e) {
        patchChat(tabId, () => ({ status: 'error', error: (e as Error).message }))
      }
    },
    interrupt: (tabId) => void window.loom.chatInterrupt(tabId),
    setModel: (tabId, model) => {
      get().rememberChoice({ defaultModel: model })
      get().updateTab(tabId, { model })
      patchChat(tabId, () => ({ activeModel: model || undefined }))
      if (get().chat(tabId).opened) void window.loom.chatSetModel(tabId, model)
    },
    setMode: (tabId, mode) => {
      get().rememberChoice({ defaultPermissionMode: mode })
      get().updateTab(tabId, { permissionMode: mode })
      patchChat(tabId, () => ({ permissionMode: mode }))
      if (get().chat(tabId).opened) void window.loom.chatSetMode(tabId, mode)
    },
    setEffort: (tabId, effort) => {
      get().rememberChoice({ defaultEffort: effort })
      get().updateTab(tabId, { effort } as Partial<ChatTab>)
      const tab = get().tabs.find((t) => t.id === tabId)
      if (get().chat(tabId).opened && tab?.kind === 'chat') void window.loom.chatSetEffort(tabId, effort, tab.ultracode === true)
    },
    setUltracode: (tabId, on) => {
      get().rememberChoice({ defaultUltracode: on })
      get().updateTab(tabId, { ultracode: on } as Partial<ChatTab>)
      const tab = get().tabs.find((t) => t.id === tabId)
      if (get().chat(tabId).opened && tab?.kind === 'chat') void window.loom.chatSetEffort(tabId, tab.effort ?? null, on)
    },
    loadIcon: async (projectId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      const others = get().projects.filter((x) => x.id !== projectId).map((x) => x.path)
      const url = await window.loom.projectIcon(p.path, p.iconMode ?? 'auto', p.iconPath ?? null, others).catch(() => null)
      set((s) => ({ icons: { ...s.icons, [projectId]: url } }))
    },
    loadGroupIcon: async (groupId) => {
      const path = get().groups.find((g) => g.id === groupId)?.iconPath
      const url = path ? await window.loom.readIcon(path).catch(() => null) : null
      set((s) => ({ groupIcons: { ...s.groupIcons, [groupId]: url } }))
    },
    rememberChoice: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      // A popout saves nothing itself: the main window keeps the choice.
      if (POPOUT_TAB) window.loom.mainDo('rememberChoice', [patch])
    },
    chatDefaults: () => {
      const st = get().settings
      return {
        model: st.defaultModel ?? null,
        permissionMode: st.defaultPermissionMode ?? null,
        effort: st.defaultEffort ?? null,
        ultracode: st.defaultUltracode === true
      }
    },
    loadCommands: async (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'chat' || get().chat(tabId).commands.length) return
      const list = await window.loom.commandsList(tab.cwd).catch(() => [])
      if (list.length && !get().chat(tabId).commands.length) patchChat(tabId, () => ({ commands: list }))
    },
    openPreview: (projectId, url, beside = true) => {
      if (POPOUT_TAB) return window.loom.mainDo('openPreview', [projectId, url, beside])
      const s = get()
      const server = s.servers.find((x) => x.projectId === projectId && x.url)
      const target = url ?? server?.url ?? 'http://localhost:3000/'
      const origin = (u: string): string => {
        try {
          return new URL(u).origin
        } catch {
          return u
        }
      }
      let tab = s.tabs.find((t): t is BrowserTab => t.kind === 'browser' && t.projectId === projectId && origin(t.url) === origin(target))
      if (!tab) {
        let title = target
        try {
          title = new URL(target).host
        } catch {
          // not a full address; show it as typed
        }
        tab = { id: uid(), kind: 'browser', projectId, url: target, title }
        const added = tab
        set((st) => ({ tabs: [...st.tabs, added] }))
      }
      if (paneOfTab(get().layout, tab.id) || get().detached[tab.id] || !beside) return get().activate(tab.id)
      // Beside: in another pane if there is one, else a new pane to the right.
      const other = panesOf(get().layout).find((p) => p.id !== get().focusedPane)
      if (other) get().moveTabToPane(tab.id, other.id)
      else get().splitPane('right', tab.id)
    },
    focusPane: (paneId, byPointer = false) => {
      const s = get()
      if (s.focusedPane === paneId) return
      const pane = paneById(s.layout, paneId)
      if (!pane) return
      set({ focusedPane: paneId, activeTabId: pane.tabId, pointerFocus: byPointer })
      if (pane.tabId) {
        const id = pane.tabId
        set((st) => ({ history: [...st.history.filter((h) => h !== id), id].slice(-50) }))
        if (get().chats[id]?.unread) patchChat(id, () => ({ unread: false }))
        const tab = get().tabs.find((t) => t.id === id)
        if (tab?.projectId) void get().refreshGit(tab.projectId)
      }
    },
    splitPane: (edge, tabId, paneId) => {
      const s = get()
      const target = paneId ?? s.focusedPane
      const onScreen = new Set(panesOf(s.layout).map((p) => p.tabId))
      const spare = (except: string | null): string | null =>
        [...s.history].reverse().find((h) => h !== except && !onScreen.has(h) && s.tabs.some((t) => t.id === h)) ??
        s.tabs.find((t) => t.id !== except && !onScreen.has(t.id))?.id ??
        null
      let layout = s.layout
      let tab = tabId ?? null
      if (tab) {
        // Moving a tab that's on screen: its old pane shows something else.
        const from = paneOfTab(layout, tab)
        if (from) layout = setPaneTab(layout, from.id, spare(tab))
      } else tab = spare(null)
      const added = newPane(tab)
      layout = splitLayout(layout, target, edge, added)
      set({ layout, focusedPane: added.id, activeTabId: tab, pointerFocus: false })
      if (tab) get().activate(tab)
    },
    moveTabToPane: (tabId, paneId) => {
      const s = get()
      const target = paneById(s.layout, paneId)
      if (!target) return
      const from = paneOfTab(s.layout, tabId)
      let layout = s.layout
      if (from && from.id !== paneId) layout = setPaneTab(layout, from.id, target.tabId)
      layout = setPaneTab(layout, paneId, tabId)
      set({ layout, focusedPane: paneId })
      get().activate(tabId)
    },
    closePane: (paneId) => {
      const s = get()
      const id = paneId ?? s.focusedPane
      const list = panesOf(s.layout)
      if (list.length < 2) return
      const at = list.findIndex((p) => p.id === id)
      const layout = removePane(s.layout, id)
      const left = panesOf(layout)
      const next = id === s.focusedPane ? left[Math.max(0, Math.min(at - 1, left.length - 1))] : (paneById(layout, s.focusedPane) ?? left[0])
      set({ layout, focusedPane: next.id, activeTabId: next.tabId, pointerFocus: false })
    },
    applyPreset: (name) => {
      const s = get()
      const focusedTab = paneById(s.layout, s.focusedPane)?.tabId ?? null
      const shown = panesOf(s.layout).map((p) => p.tabId)
      const order: string[] = []
      for (const id of [focusedTab, ...shown, ...[...s.history].reverse(), ...s.tabs.map((t) => t.id)]) {
        if (id && !order.includes(id) && s.tabs.some((t) => t.id === id)) order.push(id)
      }
      const count = PRESETS.find((p) => p.name === name)?.panes ?? 1
      const layout = presetLayout(name, order.slice(0, count))
      const first = panesOf(layout)[0]
      set({ layout, focusedPane: first.id, activeTabId: first.tabId, pointerFocus: false })
    },
    resizeSplit: (splitId, sizes) => set((s) => ({ layout: setSizes(s.layout, splitId, sizes) })),
    loadRunTargets: async (projectId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return []
      const others = get().projects.filter((x) => x.id !== projectId).map((x) => x.path)
      const targets = await window.loom.detectRun(p.path, others).catch(() => [] as RunTarget[])
      set((s) => ({ runTargets: { ...s.runTargets, [projectId]: targets } }))
      return targets
    },
    runProject: async (projectId, targetId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      // Look again: package.json may have changed since Loom started.
      const targets = await get().loadRunTargets(projectId)
      const target =
        targets.find((t) => t.id === targetId) ?? targets.find((t) => t.id === p.runTargetId) ?? targets[0]
      if (!target) return
      if (targetId && targetId !== p.runTargetId) get().updateProject(projectId, { runTargetId: targetId })
      const info = await window.loom.serverStart(projectId, target)
      set((s) => ({ servers: s.servers.some((x) => x.id === info.id) ? s.servers : [...s.servers, info] }))
    },
    stopServer: (serverId) => void window.loom.serverStop(serverId),
    restartServer: (serverId) => void window.loom.serverRestart(serverId),
    dismissServer: (serverId) => void window.loom.serverDismiss(serverId),
    showServerOutput: (serverId) => {
      if (POPOUT_TAB) return window.loom.mainDo('showServerOutput', [serverId])
      const open = get().tabs.find((t) => t.kind === 'server' && t.serverId === serverId)
      if (open) return get().activate(open.id)
      const server = get().servers.find((x) => x.id === serverId)
      if (!server) return
      get().openTab({ id: uid(), kind: 'server', projectId: server.projectId, serverId, title: server.target.command })
    },
    refreshUsage: async (force) => {
      const usage = await window.loom.getUsage(force)
      if (usage) set({ usage })
    },
    respond: (tabId, requestId, response) => {
      patchChat(tabId, (c) => ({ permissions: c.permissions.filter((p) => p.requestId !== requestId) }))
      void window.loom.chatRespond(tabId, requestId, response)
    },
    setDraft: (tabId, draft) => patchChat(tabId, () => ({ draft })),

    handleChatEvent: (tabId, ev) => {
      switch (ev.type) {
        case 'items':
          patchChat(tabId, (c) => {
            const items = [...c.items]
            const now = new Date().toISOString()
            for (const raw of ev.items) {
              // Live messages get the time they arrived, as saved ones carry theirs.
              const item = (raw.kind === 'user' || raw.kind === 'assistant') && !raw.ts ? { ...raw, ts: now } : raw
              const at = items.findIndex((x) => x.id === item.id)
              if (at >= 0) items[at] = item
              else items.push(item)
            }
            return { items }
          })
          break
        case 'tool-result':
          patchChat(tabId, (c) => {
            const items = [...c.items]
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i]
              if (it.kind === 'tool' && it.id === ev.toolUseId) {
                items[i] = { ...it, result: ev.result, isError: ev.isError, status: ev.isError ? 'error' : 'done', ms: ev.ms ?? it.ms }
                break
              }
            }
            return { items }
          })
          break
        case 'partial':
          patchChat(tabId, () => ({ partial: ev.text }))
          break
        case 'partial-clear':
          patchChat(tabId, () => ({ partial: '' }))
          break
        case 'status':
          patchChat(tabId, (c) => ({
            status: ev.status,
            error: ev.error,
            items:
              ev.status === 'stopped' || ev.status === 'error' || ev.status === 'idle'
                ? c.items.map((it) => (it.kind === 'tool' && it.status === 'running' && ev.status !== 'idle' ? { ...it, status: 'done' as const } : it))
                : c.items
          }))
          break
        case 'session': {
          get().updateTab(tabId, { sessionId: ev.sessionId } as Partial<ChatTab>)
          patchChat(tabId, (c) => ({
            activeModel: ev.model ?? c.activeModel,
            permissionMode: ev.permissionMode ?? c.permissionMode,
            historyState: c.historyState === 'none' ? 'loaded' : c.historyState
          }))
          break
        }
        case 'permission':
          patchChat(tabId, (c) => ({ permissions: [...c.permissions, ev.request], unread: get().activeTabId !== tabId }))
          break
        case 'permission-done':
          patchChat(tabId, (c) => ({ permissions: c.permissions.filter((p) => p.requestId !== ev.requestId) }))
          break
        case 'context':
          patchChat(tabId, () => ({ context: ev.context }))
          break
        case 'turn-done': {
          patchChat(tabId, (c) => {
            const now = Date.now()
            const items: ChatItem[] = c.items.map((it) =>
              it.kind === 'tool' && it.status === 'running'
                ? { ...it, status: 'done' as const, ms: it.startedAt ? now - it.startedAt : undefined }
                : it
            )
            if (ev.durationMs && ev.durationMs >= 1000) items.push({ kind: 'done', id: uid(), ms: ev.durationMs })
            return { unread: get().activeTabId !== tabId, items }
          })
          const tab = get().tabs.find((t) => t.id === tabId)
          if (tab?.projectId) void get().refreshGit(tab.projectId)
          void get().refreshSessions(true)
          break
        }
        case 'models':
          if (ev.models.length) set({ knownModels: ev.models })
          break
        case 'commands':
          patchChat(tabId, () => ({ commands: ev.commands }))
          break
        case 'mode':
          get().updateTab(tabId, { permissionMode: ev.permissionMode })
          patchChat(tabId, () => ({ permissionMode: ev.permissionMode }))
          break
      }
    },

    refreshSessions: async (force) => {
      try {
        const sessions = await window.loom.listSessions(force)
        set({ sessions })
      } catch {
        // keep the previous list
      }
    },
    refreshChanges: async (projectId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      const changes = await window.loom.gitChanges(p.path).catch(() => null)
      set((s) => ({ gitChanges: { ...s.gitChanges, [projectId]: changes } }))
      void get().refreshGit(projectId)
    },
    openDiff: (projectId, path, commit, commitLabel) => {
      if (POPOUT_TAB) return window.loom.mainDo('openDiff', [projectId, path, commit, commitLabel])
      const open = get().tabs.find((t) => t.kind === 'diff' && normPath(t.path) === normPath(path) && (t.commit ?? null) === (commit ?? null))
      if (open) return get().activate(open.id)
      const name = baseName(path)
      const tab: DiffTab = { id: uid(), kind: 'diff', projectId, path, commit, title: commit ? `${name} @ ${commitLabel ?? commit.slice(0, 7)}` : `${name} changes` }
      get().openTab(tab)
    },
    refreshGit: async (projectId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      const status = await window.loom.gitStatus(p.path)
      set((s) => ({ git: { ...s.git, [projectId]: status } }))
    },
    showMenu: (e, items) => set({ menu: { x: e.clientX, y: e.clientY, items } })
  }
})

/** A readable model name: the account's label when known, else "Opus 5.5" style from the id. */
export function modelName(id: string | undefined, known: { value: string; label: string; resolved?: string }[]): string | undefined {
  if (!id) return undefined
  const hit = known.find((m) => m.value === id || m.resolved === id)
  if (hit) return hit.label
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  return id[0].toUpperCase() + id.slice(1)
}

export function activeTab(s: { tabs: Tab[]; activeTabId: string | null }): Tab | null {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? null
}

export function sessionsForProject(sessions: SessionSummary[], projects: Project[], projectId: string): SessionSummary[] {
  return sessions.filter((s) => projectForPath(projects, s.cwd)?.id === projectId)
}
