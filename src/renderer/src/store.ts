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
  type SubFolder,
  type TerminalTab,
  type SlashCommandInfo,
  type Tab,
  type TabSnapshot,
  type UpdateStatus,
  type AgentTask,
  type UsageSnapshot
} from '@shared/types'
import {
  cleanLayout,
  inFileRow,
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
import { baseName, isInside, joinPath, normPath, parentDir, projectForPath, shortPath, thumbnailOf, uid } from './lib/paths'

export interface ChatRuntime {
  items: ChatItem[]
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
  /** Sub-agents and background tasks running now */
  tasks: AgentTask[]
  /** Images waiting in the message box */
  attachments: ImageAttachment[]
  /** Being moved to another project: no messages until it's done */
  moving?: boolean
}

/**
 * What streams in many times a second: the reply being written and the thought in progress, per
 * chat tab. Kept apart from the main store so a streaming chat redraws only itself.
 */
export const useLive = create<{ partial: Record<string, string>; thinking: Record<string, { text: string; since: number } | null> }>(() => ({
  partial: {},
  thinking: {}
}))

function clearLive(tabId: string, which: 'all' | 'thinking' = 'all'): void {
  const l = useLive.getState()
  if (!(tabId in l.thinking) && (which === 'thinking' || !(tabId in l.partial))) return
  useLive.setState((s) => {
    const thinking = { ...s.thinking }
    delete thinking[tabId]
    if (which === 'thinking') return { thinking }
    const partial = { ...s.partial }
    delete partial[tabId]
    return { thinking, partial }
  })
}

/**
 * Keeps the main process told which files have unsaved edits in this window, so quitting or
 * restarting for an update can say so first.
 */
function reportUnsaved(get: () => { tabs: Tab[]; dirtyFiles: Record<string, boolean> }): void {
  let last = ''
  const send = (): void => {
    const s = get()
    const names = s.tabs.filter((t) => t.kind === 'file' && s.dirtyFiles[t.id]).map((t) => t.title)
    const key = names.join('\n')
    if (key === last) return
    last = key
    window.loom.reportUnsaved(names)
  }
  send()
  useStore.subscribe((s, prev) => {
    if (s.dirtyFiles !== prev.dirtyFiles || s.tabs !== prev.tabs) send()
  })
}

/** A chat with nothing in it yet; a shared value, so selectors that fall back to it stay stable. */
export const EMPTY_CHAT: ChatRuntime = Object.freeze(newChatRuntime()) as ChatRuntime

/** This window shows one tab that was moved out of the main window. */
export const POPOUT_TAB = new URLSearchParams(location.search).get('popout')

/** Unsaved text of open file tabs, read when a tab moves to another window. FileView keeps it current. */
export const liveDrafts = new Map<string, () => string | null>()
/** Saves an open file tab; false when it couldn't be saved (changed on disk, write failed). FileView registers it. */
export const fileSavers = new Map<string, () => Promise<boolean>>()

export interface ConfirmChoice {
  id: string
  label: string
  kind?: 'primary' | 'danger' | 'ghost'
}

export interface ConfirmRequest {
  title: string
  body?: string
  /** What it affects, listed under the message */
  items?: string[]
  choices: ConfirmChoice[]
  /** Picked by Esc or a click outside */
  cancel: string
  /** Where keyboard focus starts; the cancel choice when unset */
  focus?: string
  /** A text box under the message; Enter picks the first choice */
  input?: { value: string; placeholder?: string; select?: [number, number] }
}

/**
 * Settings shows over the whole work area instead of inside a pane, so opening and closing it
 * leaves the panes exactly as they were.
 */
export function isOverlayTab(tab: Pick<Tab, 'kind'> | undefined | null): boolean {
  return tab?.kind === 'settings'
}

/** Tabs in the order they appear: the top row, then the files row. */
export function tabsInOrder(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => !inFileRow(t)), ...tabs.filter((t) => inFileRow(t))]
}

/** A chat in the middle of something: a turn, a question for you, or agents still running. */
export function chatBusy(c: ChatRuntime | undefined): boolean {
  return !!c && (chatWorking(c) || c.permissions.length > 0)
}

/** Claude, or agents it started, at work in this chat. */
export function chatWorking(c: ChatRuntime | undefined): boolean {
  return !!c && (c.status === 'running' || c.status === 'starting' || (c.tasks?.length ?? 0) > 0)
}

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
  /** The installed app's updates: checking, downloading, ready to restart */
  update: UpdateStatus | null
  /** Folders that appeared in a group's watched folder and aren't projects yet, by group id */
  watchNew: Record<string, SubFolder[]>
  /** The image viewer, open on one of a message's images */
  viewer: { images: ImagePreview[]; index: number } | null
  confirm: (ConfirmRequest & { resolve: (choice: string, text?: string) => void }) | null
  /** Bumped when files may have changed, so open folders in the Files panel read again */
  treeVersion: number
  toasts: { id: string; text: string }[]
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
  /** Starts watching a folder for a group. Folders made in the last day count as new. */
  watchFolder: (groupId: string, path: string) => Promise<void>
  unwatchFolder: (groupId: string) => void
  /** Looks in every watched folder for folders that aren't projects or offered before. */
  checkWatched: () => Promise<void>
  /** Adds offered folders to the group as projects */
  addWatched: (groupId: string, folders: SubFolder[]) => void
  /** Stops offering these folders */
  hideWatched: (groupId: string, folders: SubFolder[]) => void
  moveProject: (projectId: string, groupId: string | null, beforeProjectId?: string | null) => void

  activate: (tabId: string) => void
  openTab: (tab: Tab) => void
  closeTab: (tabId: string) => void
  moveTab: (tabId: string, toIndex: number) => void
  updateTab: (tabId: string, patch: Partial<Tab>) => void
  newChat: (projectId: string | null) => void
  openSession: (session: SessionSummary) => void
  /** Moves a chat to another project: its history goes with it, and Claude works in the new folder. */
  moveChat: (ref: { tabId?: string; session?: SessionSummary }, projectId: string) => Promise<void>
  openFile: (path: string, projectId?: string | null) => void
  newTerminal: (projectId: string | null, cwd?: string) => void
  openSettings: () => void
  /** The getting-started steps, in a tab of their own. */
  openStart: () => void
  /** Opens a terminal beside the steps running `claude auth login`. */
  openLoginTerminal: () => Promise<void>
  /** Runs Anthropic's Claude Code installer in a terminal beside the getting-started steps. */
  openInstallTerminal: () => void

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
  setAttachments: (tabId: string, attachments: ImageAttachment[]) => void
  handleChatEvent: (tabId: string, event: ChatEvent) => void

  refreshSessions: (force?: boolean) => Promise<void>
  refreshGit: (projectId: string) => Promise<void>
  /** Git state of every project, a few at a time, for the sidebar's git marks. */
  refreshAllGit: () => Promise<void>
  refreshChanges: (projectId: string) => Promise<void>
  /** A file's changes in a tab: uncommitted ones, or the ones made in a commit. */
  openDiff: (projectId: string | null, path: string, commit?: string, commitLabel?: string) => void
  showMenu: (e: { clientX: number; clientY: number }, items: MenuItem[]) => void
  /** Asks a question in Loom's own dialog; resolves with the id of the choice picked. */
  ask: (req: ConfirmRequest) => Promise<string>
  showToast: (text: string) => void
  dismissToast: (id: string) => void
  /** Asks for a name; null when cancelled or left empty. */
  askText: (req: { title: string; body?: string; value: string; placeholder?: string; select?: [number, number]; confirm: string }) => Promise<string | null>
  bumpTree: () => void
  createEntry: (dir: string, kind: 'file' | 'folder', projectId: string | null) => Promise<void>
  renameEntry: (path: string) => Promise<void>
  trashEntry: (path: string, isDir: boolean) => Promise<void>
  /** Closes tabs the way a person asks to: offers to save unsaved files, warns about working chats. */
  requestClose: (tabIds: string[]) => Promise<boolean>
  requestRemoveProject: (id: string) => Promise<void>
  /** Tabs closed in this session, newest last, for Reopen closed tab */
  closedTabs: Tab[]
  reopenClosed: () => void
  requestDeleteGroup: (id: string) => Promise<void>
}

export function newChatRuntime(): ChatRuntime {
  return {
    items: [],
    status: 'idle',
    permissions: [],
    tasks: [],
    attachments: [],
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
  'onboarded',
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
      // Late news for a tab that has closed (a history load, a last event) stays dropped.
      if (!s.tabs.some((t) => t.id === tabId)) return s
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
    onboarded: undefined,

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
    update: null,
    watchNew: {},
    viewer: null,
    confirm: null,
    toasts: [],
    closedTabs: [],
    treeVersion: 0,
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
          fileDrafts: snapshot?.fileDraft != null ? { [tab.id]: snapshot.fileDraft } : {},
          info,
          ready: true
        })
        window.loom.popoutReady()
        reportUnsaved(get)
        let sent = tab
        let sentChat = ''
        useStore.subscribe((st) => {
          const now = st.tabs[0]
          if (now && now !== sent) {
            sent = now
            window.loom.popoutTab(now)
          }
          // The main window keeps showing this chat's tab, sidebar row and status: keep them true.
          const c = now && st.chats[now.id]
          if (c) {
            const state = { status: c.status, permissions: c.permissions, tasks: c.tasks, unread: c.unread }
            const key = JSON.stringify([state.status, state.permissions.map((p) => p.requestId), state.tasks.map((t) => [t.id, t.toolUses]), state.unread])
            if (key !== sentChat) {
              sentChat = key
              window.loom.popoutChatState(now.id, state)
            }
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
      window.loom.onPopoutChatState((tabId, state) => {
        if (get().detached[tabId]) patchChat(tabId, () => state)
      })
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
          // Whatever the other window had is now the truth: its unsaved text, or none because it
          // saved there. A copy parked here when the tab left must not come back over it.
          const fileDrafts = { ...st.fileDrafts }
          if (snapshot.fileDraft != null) fileDrafts[tabId] = snapshot.fileDraft
          else delete fileDrafts[tabId]
          patch.fileDrafts = fileDrafts
        }
        set(patch)
        get().activate(tabId)
      })
      window.loom.onMainDo((action, args) => {
        const st = get() as unknown as Record<string, (...a: unknown[]) => void>
        if (['openFile', 'newChat', 'newTerminal', 'openSettings', 'openSession', 'showServerOutput', 'runProject', 'openPreview', 'rememberChoice', 'openDiff', 'openStart'].includes(action)) st[action](...args)
      })
      // Server output tabs belong to servers that stopped when Loom last quit.
      const tabs = state.tabs.filter((t) => t.kind !== 'server')
      const paneTabs = tabs.filter((t) => !isOverlayTab(t))
      const fallback = paneTabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : (paneTabs[0]?.id ?? null)
      let layout = cleanLayout(state.layout ?? { kind: 'pane', id: 'main', tabId: fallback }, new Set(tabs.filter((t) => !isOverlayTab(t)).map((t) => t.id)))
      let focused = paneById(layout, state.focusedPane ?? '') ?? panesOf(layout)[0]
      // A saved layout whose tabs are gone would open empty: show the last tab used instead.
      if (!focused.tabId && fallback && !panesOf(layout).some((p) => p.tabId === fallback)) {
        layout = setPaneTab(layout, focused.id, fallback)
        focused = paneById(layout, focused.id)!
      }
      set({ ...state, tabs, layout, focusedPane: focused.id, activeTabId: focused.tabId, info, ready: true })
      // First launch: nothing saved yet, so show the getting-started steps.
      if (state.onboarded === undefined && !state.projects.length && !tabs.some((t) => t.kind === 'start')) get().openStart()
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
      reportUnsaved(get)
      // A change made just before closing (a tab closed, a divider moved) is sent now, not lost.
      window.addEventListener('beforeunload', () => {
        if (!timer) return
        clearTimeout(timer)
        timer = null
        window.loom.saveState(pickPersisted(get()))
      })
      void get().refreshSessions(true)
      for (const p of get().projects) void get().loadIcon(p.id)
      for (const g of get().groups) void get().loadGroupIcon(g.id)
      for (const p of get().projects) void get().loadRunTargets(p.id)
      // Which projects are in git, for the sidebar: soon after start, then every few minutes.
      setTimeout(() => void get().refreshAllGit(), 1500)
      setInterval(() => {
        if (document.hasFocus()) void get().refreshAllGit()
      }, 3 * 60_000)
      // Watched folders: soon after start, every minute while Loom is in front, and on focus (App).
      setTimeout(() => void get().checkWatched(), 2000)
      setInterval(() => {
        if (document.hasFocus()) void get().checkWatched()
      }, 60_000)
      window.loom.onUpdate((update) => set({ update }))
      void window.loom.updateStatus().then((update) => set({ update }))
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
      void get().refreshGit(project.id)
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
    watchFolder: async (groupId, path) => {
      const now = Date.now()
      const folders = await window.loom.subfolders(path)
      // Everything already there counts as seen, except what arrived in the last day (a pull just now, say).
      const seen = folders.filter((f) => now - f.created > 24 * 60 * 60_000).map((f) => f.name)
      get().updateGroup(groupId, { watchPath: path, watchSeen: seen })
      await get().checkWatched()
    },
    unwatchFolder: (groupId) => {
      get().updateGroup(groupId, { watchPath: undefined, watchSeen: undefined })
      set((s) => {
        const watchNew = { ...s.watchNew }
        delete watchNew[groupId]
        return { watchNew }
      })
    },
    checkWatched: async () => {
      const watched = get().groups.filter((g) => g.watchPath)
      const found = await Promise.all(watched.map((g) => window.loom.subfolders(g.watchPath!)))
      const watchNew: Record<string, SubFolder[]> = {}
      watched.forEach((g, i) => {
        const seen = new Set(g.watchSeen ?? [])
        const fresh = found[i].filter((f) => !seen.has(f.name) && !get().projects.some((p) => normPath(p.path) === normPath(f.path)))
        if (fresh.length) watchNew[g.id] = fresh.sort((a, b) => a.name.localeCompare(b.name))
      })
      set({ watchNew })
    },
    addWatched: (groupId, folders) => {
      for (const f of folders) get().addProject(f.path, groupId)
      get().hideWatched(groupId, folders)
    },
    hideWatched: (groupId, folders) => {
      const g = get().groups.find((x) => x.id === groupId)
      if (!g) return
      const names = new Set(folders.map((f) => f.name))
      get().updateGroup(groupId, { watchSeen: [...new Set([...(g.watchSeen ?? []), ...names])] })
      set((s) => {
        const rest = (s.watchNew[groupId] ?? []).filter((f) => !names.has(f.name))
        const watchNew = { ...s.watchNew }
        if (rest.length) watchNew[groupId] = rest
        else delete watchNew[groupId]
        return { watchNew }
      })
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
      if (isOverlayTab(get().tabs.find((t) => t.id === tabId))) {
        set((s) => ({ activeTabId: tabId, pointerFocus: false, history: [...s.history.filter((h) => h !== tabId), tabId].slice(-50) }))
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
      // Closing the steps counts as done with them: they don't come back by themselves.
      if (tab.kind === 'start') set({ onboarded: true })
      if (tab.kind === 'chat') void window.loom.chatClose(tabId)
      if (tab.kind === 'terminal') void window.loom.ptyKill(tabId)
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      // A pane that showed it goes back to the tab used before, like an editor does, among tabs not
      // already on screen; failing that the nearest neighbour; failing that it stays empty.
      const onScreen = new Set(panesOf(s.layout).map((p) => p.tabId))
      const replacement = (): string | null => {
        const fits = (id: string): boolean => !onScreen.has(id) && !s.detached[id] && !isOverlayTab(tabs.find((t) => t.id === id))
        const back = [...s.history].reverse().find((h) => h !== tabId && fits(h) && tabs.some((t) => t.id === h))
        if (back) return back
        const free = tabs.map((t, i) => ({ id: t.id, d: Math.abs(i - idx) })).filter((x) => fits(x.id))
        return free.sort((a, b) => a.d - b.d)[0]?.id ?? null
      }
      let layout = s.layout
      for (const p of panesOf(layout)) {
        if (p.tabId !== tabId) continue
        const next = replacement()
        layout = setPaneTab(layout, p.id, next)
        onScreen.add(next)
      }
      // Closing something else while Settings is open keeps Settings in front.
      const activeTabId = s.activeTabId !== tabId && isOverlayTab(tabs.find((t) => t.id === s.activeTabId)) ? s.activeTabId : (paneById(layout, s.focusedPane)?.tabId ?? null)
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
      // Chats with history, files, previews and diffs can come back; a shell or a dev server can't.
      const reopenable = (tab.kind === 'chat' && tab.sessionId) || tab.kind === 'file' || tab.kind === 'browser' || tab.kind === 'diff'
      const closedTabs = reopenable ? [...s.closedTabs.filter((t) => t.id !== tabId), tab].slice(-20) : s.closedTabs
      set({ tabs, layout, activeTabId, chats, terminals, dirtyFiles, detached, fileDrafts, closedTabs })
      clearLive(tabId)
      if (activeTabId) get().activate(activeTabId)
    },
    popOut: (tabId, at) => {
      const s = get()
      const tab = s.tabs.find((t) => t.id === tabId)
      // Settings and Get started change Loom itself, which a window of its own can't do.
      if (!tab || s.detached[tabId] || POPOUT_TAB || tab.kind === 'settings' || tab.kind === 'start') return
      // Its pane shows the tab used before it, as when a tab closes.
      const onScreen = new Set(panesOf(s.layout).map((p) => p.tabId))
      const fits = (id: string): boolean => id !== tabId && !onScreen.has(id) && !s.detached[id] && !isOverlayTab(s.tabs.find((t) => t.id === id))
      const back = [...s.history].reverse().find((h) => fits(h) && s.tabs.some((t) => t.id === h)) ?? s.tabs.find((t) => fits(t.id))?.id ?? null
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
    moveChat: async (ref, projectId) => {
      if (POPOUT_TAB) return
      const project = get().projects.find((p) => p.id === projectId)
      if (!project) return
      // A saved chat that isn't open opens first, so the move has somewhere to report back.
      if (!ref.tabId && ref.session) get().openSession(ref.session)
      const tab = get().tabs.find(
        (t): t is ChatTab => t.kind === 'chat' && (ref.tabId ? t.id === ref.tabId : t.sessionId === ref.session?.sessionId)
      )
      if (!tab || tab.projectId === project.id) return
      const note = (text: string, tone: 'info' | 'error' = 'info'): void =>
        patchChat(tab.id, (c) => ({ items: [...c.items, { kind: 'note', id: uid(), tone, text }] }))
      const c = get().chat(tab.id)
      if (get().detached[tab.id]) return get().showToast('Bring this chat back to the main window first, then move it.')
      if (chatBusy(c)) {
        return note('Claude is still working in this chat. Move it once the reply is done.', 'error')
      }
      // No messages while the history file moves: one would land in the old folder.
      patchChat(tab.id, () => ({ moving: true }))
      try {
        // Claude Code keeps the chat open between messages; it has to let go of it first, and a
        // chat that opened without getting an id yet would otherwise go on in the old folder.
        if (c.opened) {
          await window.loom.chatClose(tab.id)
          patchChat(tab.id, () => ({ opened: false, status: 'idle' }))
        }
        if (tab.sessionId) {
          const r = await window.loom.moveSession(tab.sessionId, tab.cwd, project.path)
          if (!r.ok) return note(r.error ?? 'The chat could not be moved.', 'error')
        }
      } finally {
        patchChat(tab.id, () => ({ moving: false }))
      }
      get().updateTab(tab.id, { projectId: project.id, cwd: project.path } as Partial<ChatTab>)
      // Skills and commands can differ per folder: fetch them again for the new one.
      patchChat(tab.id, () => ({ commands: [] }))
      note(`Moved to ${project.name}. From the next message Claude works in ${project.path}.`)
      void get().refreshSessions(true)
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
    newTerminal: (projectId, dir) => {
      if (POPOUT_TAB) return window.loom.mainDo('newTerminal', [projectId, dir])
      const project = get().projects.find((p) => p.id === projectId) ?? null
      const cwd = dir ?? project?.path ?? get().info?.homeDir ?? 'C:\\'
      const count = get().tabs.filter((t) => t.kind === 'terminal' && t.projectId === (project?.id ?? null)).length
      get().openTab({ id: uid(), kind: 'terminal', projectId: project?.id ?? null, cwd, title: count ? `Terminal ${count + 1}` : 'Terminal' })
    },
    openStart: () => {
      if (POPOUT_TAB) return window.loom.mainDo('openStart', [])
      const open = get().tabs.find((t) => t.kind === 'start')
      if (open) return get().activate(open.id)
      get().openTab({ id: uid(), kind: 'start', projectId: null, title: 'Get started' })
    },
    openLoginTerminal: async () => {
      const open = get().tabs.find((t) => t.kind === 'terminal' && t.title === 'Sign in to Claude')
      if (open) return get().activate(open.id)
      const exe = await window.loom.claudeProgram()
      const shell = get().settings.shell
      const run =
        shell === 'powershell'
          ? `& "${exe}" auth login`
          : shell === 'gitbash'
            ? `"${exe.replace(/\\/g, '/')}" auth login`
            : `"${exe}" auth login`
      const tab: TerminalTab = {
        id: uid(),
        kind: 'terminal',
        projectId: null,
        cwd: get().info?.homeDir ?? 'C:\\',
        title: 'Sign in to Claude',
        run
      }
      set((s) => ({ tabs: [...s.tabs, tab] }))
      // Beside the steps, so both stay in view while the browser does the signing in.
      get().splitPane('right', tab.id)
    },
    openInstallTerminal: () => {
      // Pressed again: the terminal already open comes forward instead of a second one.
      const open = get().tabs.find((t) => t.kind === 'terminal' && t.title === 'Install Claude Code')
      if (open) return get().activate(open.id)
      // Anthropic's own installer, as its docs give it for each shell.
      const shell = get().settings.shell
      const ps = 'irm https://claude.ai/install.ps1 | iex'
      const run =
        shell === 'powershell'
          ? ps
          : shell === 'cmd'
            ? 'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd'
            : `powershell -NoProfile -Command "${ps}"`
      const tab: TerminalTab = {
        id: uid(),
        kind: 'terminal',
        projectId: null,
        cwd: get().info?.homeDir ?? 'C:\\',
        title: 'Install Claude Code',
        run
      }
      set((s) => ({ tabs: [...s.tabs, tab] }))
      get().splitPane('right', tab.id)
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
        // A message added mid-turn doesn't restart the turn's clock.
        startedAt: c.status === 'running' || c.status === 'starting' ? c.startedAt : Date.now()
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
      const fits = (id: string, except: string | null): boolean =>
        id !== except && !onScreen.has(id) && !s.detached[id] && !isOverlayTab(s.tabs.find((t) => t.id === id))
      const spare = (except: string | null): string | null =>
        [...s.history].reverse().find((h) => fits(h, except) && s.tabs.some((t) => t.id === h)) ?? s.tabs.find((t) => fits(t.id, except))?.id ?? null
      // A tab in its own window comes back first; Settings never goes in a pane.
      if (tabId && s.detached[tabId]) return void window.loom.popoutClose(tabId)
      if (tabId && isOverlayTab(s.tabs.find((t) => t.id === tabId))) return get().activate(tabId)
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
      if (s.detached[tabId]) return void window.loom.popoutClose(tabId)
      if (isOverlayTab(s.tabs.find((t) => t.id === tabId))) return get().activate(tabId)
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
        const t = s.tabs.find((x) => x.id === id)
        if (id && t && !order.includes(id) && !s.detached[id] && !isOverlayTab(t)) order.push(id)
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
    setDraft: (tabId, draft) => {
      patchChat(tabId, () => ({ draft }))
      // On the tab too, so a half-written message survives a restart or an update.
      const tab = get().tabs.find((t) => t.id === tabId)
      if (tab?.kind === 'chat' && (tab.draft ?? '') !== draft) get().updateTab(tabId, { draft: draft || undefined } as Partial<ChatTab>)
    },
    setAttachments: (tabId, attachments) => patchChat(tabId, () => ({ attachments })),

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
          useLive.setState((l) => ({ partial: { ...l.partial, [tabId]: ev.text } }))
          break
        case 'thinking-partial':
          useLive.setState((l) => ({ thinking: { ...l.thinking, [tabId]: { text: ev.text, since: l.thinking[tabId]?.since ?? Date.now() } } }))
          break
        case 'partial-clear':
          clearLive(tabId)
          break
        case 'status':
          // Stopped or done mid-thought: nothing more is coming for the live thinking.
          if (ev.status === 'stopped' || ev.status === 'error' || ev.status === 'idle') clearLive(tabId, 'thinking')
          patchChat(tabId, (c) => ({
            status: ev.status,
            error: ev.error,
            // A turn Claude started by itself has no send to time it from.
            ...(ev.status === 'running' && c.status !== 'running' && c.status !== 'starting' ? { startedAt: Date.now() } : {}),
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
          // A window that takes a chat over is sent its open questions again: keep one card each.
          patchChat(tabId, (c) => ({
            permissions: [...c.permissions.filter((p) => p.requestId !== ev.request.requestId), ev.request],
            unread: get().activeTabId !== tabId
          }))
          break
        case 'tasks':
          patchChat(tabId, () => ({ tasks: ev.tasks }))
          break
        case 'permission-done':
          patchChat(tabId, (c) => ({ permissions: c.permissions.filter((p) => p.requestId !== ev.requestId) }))
          break
        case 'context':
          patchChat(tabId, () => ({ context: ev.context }))
          break
        case 'turn-done': {
          get().bumpTree()
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
    refreshAllGit: async () => {
      const queue = get().projects.map((p) => p.id)
      const worker = async (): Promise<void> => {
        for (let id = queue.shift(); id; id = queue.shift()) await get().refreshGit(id)
      }
      await Promise.all(Array.from({ length: 6 }, worker))
    },
    refreshGit: async (projectId) => {
      const p = get().projects.find((x) => x.id === projectId)
      if (!p) return
      const status = await window.loom.gitStatus(p.path)
      set((s) => ({ git: { ...s.git, [projectId]: status } }))
    },
    showMenu: (e, items) => set({ menu: { x: e.clientX, y: e.clientY, items } }),
    ask: (req) =>
      new Promise<string>((resolve) => {
        // One question at a time: an older one still open counts as cancelled.
        const open = get().confirm
        if (open) open.resolve(open.cancel)
        set({ confirm: { ...req, resolve } })
      }),
    showToast: (text) => {
      const id = uid()
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }))
      setTimeout(() => get().dismissToast(id), 7000)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    askText: (req) =>
      new Promise<string | null>((resolve) => {
        const open = get().confirm
        if (open) open.resolve(open.cancel)
        set({
          confirm: {
            title: req.title,
            body: req.body,
            choices: [
              { id: 'ok', label: req.confirm, kind: 'primary' },
              { id: 'cancel', label: 'Cancel', kind: 'ghost' }
            ],
            cancel: 'cancel',
            input: { value: req.value, placeholder: req.placeholder, select: req.select },
            resolve: (choice, text) => resolve(choice === 'ok' && text?.trim() ? text.trim() : null)
          }
        })
      }),
    bumpTree: () => set((s) => ({ treeVersion: s.treeVersion + 1 })),
    createEntry: async (dir, kind, projectId) => {
      const name = await get().askText({
        title: kind === 'file' ? 'New file' : 'New folder',
        body: `In ${shortPath(dir, get().info?.homeDir)}`,
        value: '',
        placeholder: kind === 'file' ? 'name.ext' : 'Folder name',
        confirm: 'Create'
      })
      if (!name) return
      const path = joinPath(dir, name)
      const r = await window.loom.createEntry(path, kind)
      if (!r.ok) return get().showToast(r.error ?? `${name} could not be created.`)
      get().bumpTree()
      if (kind === 'file') get().openFile(path, projectId)
    },
    renameEntry: async (path) => {
      const name = baseName(path)
      const dot = name.lastIndexOf('.')
      const next = await get().askText({ title: `Rename ${name}`, value: name, select: [0, dot > 0 ? dot : name.length], confirm: 'Rename' })
      if (!next || next === name) return
      const to = joinPath(parentDir(path), next)
      const r = await window.loom.renameEntry(path, to)
      if (!r.ok) return get().showToast(r.error ?? `${name} could not be renamed.`)
      // Open files follow the rename, inside a renamed folder too.
      const moved = (p: string): string | null => (normPath(p) === normPath(path) ? to : isInside(p, path) ? to + p.slice(path.length) : null)
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.kind !== 'file') return t
          const p = moved(t.path)
          return p ? { ...t, path: p, title: baseName(p) } : t
        })
      }))
      get().bumpTree()
    },
    trashEntry: async (path, isDir) => {
      const name = baseName(path)
      const choice = await get().ask({
        title: `Move ${name} to the Recycle Bin?`,
        body: isDir ? 'Everything inside it goes too. You can restore it from the Recycle Bin.' : 'You can restore it from the Recycle Bin.',
        choices: [
          { id: 'trash', label: 'Move to Recycle Bin', kind: 'danger' },
          { id: 'cancel', label: 'Cancel', kind: 'ghost' }
        ],
        cancel: 'cancel'
      })
      if (choice !== 'trash') return
      const r = await window.loom.trashEntry(path)
      if (!r.ok) return get().showToast(r.error ?? `${name} could not be moved to the Recycle Bin.`)
      for (const t of get().tabs.filter((t) => t.kind === 'file' && (normPath(t.path) === normPath(path) || isInside(t.path, path)))) get().closeTab(t.id)
      get().bumpTree()
    },
    requestClose: async (tabIds) => {
      const pick = (): Tab[] => tabIds.map((id) => get().tabs.find((t) => t.id === id)).filter((t): t is Tab => !!t)
      const dirty = pick().filter((t) => t.kind === 'file' && get().dirtyFiles[t.id] && !get().detached[t.id])
      if (dirty.length) {
        const one = dirty.length === 1
        const choice = await get().ask({
          title: one ? `Save the changes to ${dirty[0].title}?` : `Save the changes to ${dirty.length} files?`,
          body: "If you don't save, the changes are lost.",
          items: one ? undefined : dirty.map((t) => t.title),
          choices: [
            { id: 'save', label: one ? 'Save' : 'Save all', kind: 'primary' },
            { id: 'discard', label: "Don't save", kind: 'danger' },
            { id: 'cancel', label: 'Cancel', kind: 'ghost' }
          ],
          cancel: 'cancel',
          focus: 'save'
        })
        if (choice === 'cancel') return false
        if (choice === 'save') {
          for (const t of dirty) {
            const saved = (await fileSavers.get(t.id)?.()) ?? false
            if (!saved) {
              get().activate(t.id)
              get().showToast(`${t.title} wasn't saved, so it stays open.`)
              return false
            }
          }
        }
      }
      const working = pick().filter((t) => t.kind === 'chat' && !get().detached[t.id] && chatBusy(get().chats[t.id]))
      if (working.length) {
        const one = working.length === 1
        const choice = await get().ask({
          title: one ? `Claude is still working in ${working[0].title}` : `Claude is still working in ${working.length} chats`,
          body: 'Closing stops it. The conversation is saved, and you can continue it later from the sidebar.',
          items: one ? undefined : working.map((t) => t.title),
          choices: [
            { id: 'close', label: one ? 'Stop and close' : 'Stop them and close', kind: 'danger' },
            { id: 'cancel', label: 'Cancel', kind: 'ghost' }
          ],
          cancel: 'cancel'
        })
        if (choice !== 'close') return false
      }
      for (const t of pick()) get().closeTab(t.id)
      return true
    },
    reopenClosed: () => {
      const list = [...get().closedTabs]
      const tab = list.pop()
      set({ closedTabs: list })
      if (!tab) return
      if (tab.kind === 'file') return get().openFile(tab.path, tab.projectId)
      if (tab.kind === 'chat') {
        const open = get().tabs.find((t) => t.kind === 'chat' && t.sessionId === tab.sessionId)
        if (open) return get().activate(open.id)
      }
      // The project may have gone meanwhile; the tab still opens, just without it.
      const projectId = tab.projectId && get().projects.some((p) => p.id === tab.projectId) ? tab.projectId : null
      get().openTab({ ...tab, id: uid(), projectId } as Tab)
    },
    requestRemoveProject: async (id) => {
      const p = get().projects.find((x) => x.id === id)
      if (!p) return
      const tabs = get().tabs.filter((t) => t.projectId === id)
      const terminals = tabs.filter((t) => t.kind === 'terminal').length
      const servers = get().servers.filter((x) => x.projectId === id && (x.status === 'running' || x.status === 'starting')).length
      const ends = [
        tabs.length ? `its ${tabs.length === 1 ? 'open tab closes' : `${tabs.length} open tabs close`}` : '',
        terminals ? `${terminals === 1 ? 'its terminal ends' : `${terminals} terminals end`}` : '',
        servers ? `${servers === 1 ? 'its dev server stops' : `${servers} dev servers stop`}` : ''
      ].filter(Boolean)
      const choice = await get().ask({
        title: `Remove ${p.name} from Loom?`,
        body: `The folder and its chat history stay on disk, and you can add it again later.${ends.length ? ` ${ends.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : ''}`,
        choices: [
          { id: 'remove', label: 'Remove', kind: 'danger' },
          { id: 'cancel', label: 'Cancel', kind: 'ghost' }
        ],
        cancel: 'cancel'
      })
      if (choice !== 'remove') return
      if (tabs.length && !(await get().requestClose(tabs.map((t) => t.id)))) return
      get().removeProject(id)
    },
    requestDeleteGroup: async (id) => {
      const g = get().groups.find((x) => x.id === id)
      if (!g) return
      const count = get().projects.filter((p) => p.groupId === id).length
      const choice = await get().ask({
        title: `Delete the group ${g.name}?`,
        body: `${count === 1 ? 'Its project stays' : count ? `Its ${count} projects stay` : 'Nothing else changes'}${count ? ' in Loom, outside any group' : ''}. Nothing is deleted from disk.${g.watchPath ? ' It stops watching its folder for new projects.' : ''}`,
        choices: [
          { id: 'delete', label: 'Delete group', kind: 'danger' },
          { id: 'cancel', label: 'Cancel', kind: 'ghost' }
        ],
        cancel: 'cancel'
      })
      if (choice === 'delete') get().deleteGroup(id)
    }
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
