import {
  ChevronRight,
  Ellipsis,
  GitBranch,
  FolderPlus,
  Layers,
  MessageSquarePlus,
  Play,
  Plus,
  Settings,
  SquareTerminal,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { THREAD_COLORS, type ChatTab, type GitStatus, type Group, type Project, type SessionSummary, type SubFolder } from '@shared/types'
import { baseName, normPath, projectForPath, timeAgo } from '../lib/paths'
import { chatWorking, useStore, type MenuItem } from '../store'
import { LookVideo } from './LookVideo'
import { ProjectMark } from './ProjectMark'
import { defaultTarget, primaryServer, projectRunItems, ServerMark } from './Servers'

const COLOR_NAMES: Record<string, string> = {
  woad: 'Woad blue',
  madder: 'Madder red',
  verdigris: 'Verdigris',
  weld: 'Weld yellow',
  indigo: 'Indigo',
  cochineal: 'Cochineal pink',
  lichen: 'Lichen green',
  walnut: 'Walnut',
  slate: 'Slate'
}

function InlineEdit({ value, onDone }: { value: string; onDone: (v: string | null) => void }): ReactNode {
  const [v, setV] = useState(value)
  return (
    <input
      className="inline-edit"
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || null)
        if (e.key === 'Escape') onDone(null)
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

/** "github.com/owner/repo" from either kind of remote address. */
function remoteName(url: string): string {
  return url
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, '')
    .replace(/\.git$/, '')
}

/** A project in git: full when it has a remote to push to, faded when it lives only on this PC. */
function GitMark({ git }: { git: GitStatus | null | undefined }): ReactNode {
  if (!git) return null
  const lines = [
    git.remote ? `Git, connected to ${remoteName(git.remote)}` : 'Git, only on this PC (no remote to push to)',
    git.branch ? `Branch ${git.branch}` : 'No branch checked out',
    git.changes ? `${git.changes} uncommitted ${git.changes === 1 ? 'change' : 'changes'}` : 'Nothing uncommitted',
    git.ahead ? `${git.ahead} to push` : '',
    git.behind ? `${git.behind} to pull` : ''
  ]
  // What waits, in words, as the website shows it; nothing to say when it's all up to date.
  const waiting = git.changes ? `${git.changes} to commit` : git.ahead ? `${git.ahead} to push` : git.behind ? `${git.behind} to pull` : ''
  return (
    <span
      className={`git-mark${waiting ? ' is-waiting' : ''}${git.remote ? '' : ' is-local'}`}
      title={lines.filter(Boolean).join('\n')}
      aria-label={lines[0]}
    >
      <GitBranch />
      {waiting ? <span className="git-mark-text">{waiting}</span> : null}
    </span>
  )
}

type Activity = 'running' | 'waiting' | 'unread' | null

function useProjectActivity(): Record<string, Activity> {
  const tabs = useStore((s) => s.tabs)
  const chats = useStore((s) => s.chats)
  return useMemo(() => {
    const out: Record<string, Activity> = {}
    for (const t of tabs) {
      if (t.kind !== 'chat' || !t.projectId) continue
      const c = chats[t.id]
      if (!c) continue
      const a: Activity = c.permissions.length ? 'waiting' : chatWorking(c) ? 'running' : c.unread ? 'unread' : null
      const rank = { waiting: 3, running: 2, unread: 1 } as const
      const cur = out[t.projectId]
      if (a && (!cur || rank[a] > rank[cur])) out[t.projectId] = a
    }
    return out
  }, [tabs, chats])
}

function ActivityMark({ activity }: { activity: Activity }): ReactNode {
  if (activity === 'running') return <span className="live-dot" role="img" aria-label="Claude is working" title="Claude is working" />
  if (activity === 'waiting') return <span className="dot dot-warn" title="Waiting for your approval" />
  if (activity === 'unread') return <span className="dot dot-accent" title="New reply" />
  return null
}

function ChatRow({ tab, session }: { tab?: ChatTab; session?: SessionSummary }): ReactNode {
  const activeTabId = useStore((s) => s.activeTabId)
  const chat = useStore((s) => (tab ? s.chats[tab.id] : undefined))
  const title = tab?.title ?? session?.title ?? 'Chat'
  const active = !!tab && tab.id === activeTabId
  const activity: Activity = chat
    ? chat.permissions.length
      ? 'waiting'
      : chat.status === 'running' || chat.status === 'starting'
        ? 'running'
        : chat.unread
          ? 'unread'
          : null
    : null
  const open = (): void => {
    if (tab) useStore.getState().activate(tab.id)
    else if (session) useStore.getState().openSession(session)
  }
  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const items: MenuItem[] = [{ label: 'Open', onSelect: open }]
    if (tab) items.push({ label: 'Close tab', onSelect: () => void useStore.getState().requestClose([tab.id]) })
    const id = tab?.sessionId ?? session?.sessionId
    const s = useStore.getState()
    const here = tab?.projectId ?? projectForPath(s.projects, session?.cwd ?? '')?.id ?? null
    items.push(
      { separator: true, label: '' },
      {
        label: 'Move to project',
        submenu: s.projects
          .filter((p) => p.id !== here)
          .map((p) => ({ label: p.name, onSelect: () => void s.moveChat(tab ? { tabId: tab.id } : { session }, p.id) }))
      }
    )
    if (id) items.push({ label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(id) })
    useStore.getState().showMenu(e, items)
  }
  return (
    <button className={`chat-row${active ? ' active' : ''}${tab ? ' is-open' : ''}`} onClick={open} onContextMenu={menu} title={title}>
      <span className="chat-row-title">{title}</span>
      {activity ? <ActivityMark activity={activity} /> : session && !tab ? <span className="chat-row-time">{timeAgo(session.lastModified)}</span> : null}
    </button>
  )
}

function ProjectRow({ project, activity, sessions }: { project: Project; activity: Activity; sessions: SessionSummary[] }): ReactNode {
  const s = useStore()
  const [showAll, setShowAll] = useState(false)
  const [dropHint, setDropHint] = useState(false)
  const expanded = project.collapsed === false
  const editing = s.editingProjectId === project.id
  const openTabs = s.tabs.filter((t): t is ChatTab => t.kind === 'chat' && t.projectId === project.id)
  const openIds = new Set(openTabs.map((t) => t.sessionId).filter(Boolean))
  const saved = sessions.filter((x) => !openIds.has(x.sessionId))
  const visibleSaved = showAll ? saved : saved.slice(0, 6)
  const activeProject = s.tabs.find((t) => t.id === s.activeTabId)?.projectId === project.id

  const runTarget = defaultTarget(project, s.runTargets[project.id])
  const hasServer = !!primaryServer(s.servers, project.id)

  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const runItems = projectRunItems(project)
    s.showMenu(e, [
      { label: 'New chat', onSelect: () => s.newChat(project.id) },
      { label: 'New terminal', onSelect: () => s.newTerminal(project.id) },
      { label: 'Open in File Explorer', onSelect: () => void window.loom.openPath(project.path) },
      ...(runItems.length ? [{ separator: true, label: '' }, ...runItems] : []),
      { separator: true, label: '' },
      { label: 'Rename', onSelect: () => s.set({ editingProjectId: project.id }) },
      {
        label: 'Icon',
        submenu: [
          {
            label: "Use the project's favicon",
            checked: (project.iconMode ?? 'auto') === 'auto',
            onSelect: () => s.updateProject(project.id, { iconMode: 'auto' })
          },
          {
            label: project.iconMode === 'custom' ? 'Choose another image…' : 'Choose an image…',
            checked: project.iconMode === 'custom',
            onSelect: async () => {
              const path = await window.loom.pickIcon()
              if (path) s.updateProject(project.id, { iconMode: 'custom', iconPath: path })
            }
          },
          {
            label: 'No icon, show its initial',
            checked: project.iconMode === 'none',
            onSelect: () => s.updateProject(project.id, { iconMode: 'none' })
          }
        ]
      },
      {
        label: 'Thread colour',
        submenu: THREAD_COLORS.map((c) => ({
          label: COLOR_NAMES[c],
          checked: project.color === c,
          onSelect: () => s.updateProject(project.id, { color: c })
        }))
      },
      {
        label: 'Move to group',
        submenu: [
          { label: 'No group', checked: !project.groupId, onSelect: () => s.moveProject(project.id, null) },
          ...s.groups.map((g) => ({ label: g.name, checked: project.groupId === g.id, onSelect: () => s.moveProject(project.id, g.id) })),
          { separator: true, label: '' },
          {
            label: 'New group…',
            onSelect: () => {
              const id = s.addGroup('New group')
              s.moveProject(project.id, id)
            }
          }
        ]
      },
      { separator: true, label: '' },
      { label: 'Remove from Loom…', danger: true, onSelect: () => void s.requestRemoveProject(project.id) }
    ])
  }

  return (
    <div
      className={`project thread${expanded ? ' expanded' : ''}${dropHint ? ' drop-before' : ''}`}
      data-color={project.color}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('loom/project')) return
        e.preventDefault()
        e.stopPropagation()
        setDropHint(true)
      }}
      onDragLeave={() => setDropHint(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('loom/project')
        setDropHint(false)
        if (!id) return
        // Taken here even when dropped on itself: let through, the group below would move it to the end.
        e.preventDefault()
        e.stopPropagation()
        if (id !== project.id) s.moveProject(id, project.groupId, project.id)
      }}
    >
      <div
        className={`project-row${activeProject ? ' current' : ''}`}
        role="button"
        tabIndex={0}
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData('loom/project', project.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => s.updateProject(project.id, { collapsed: expanded })}
        onKeyDown={(e) => {
          // Enter on a button inside the row (Run, New chat, More) is that button's.
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            s.updateProject(project.id, { collapsed: expanded })
          }
        }}
        onContextMenu={menu}
        title={project.path}
      >
        <ChevronRight className="chev" />
        <ProjectMark project={project} size={18} />
        {editing ? (
          <InlineEdit
            value={project.name}
            onDone={(v) => {
              if (v) s.updateProject(project.id, { name: v })
              s.set({ editingProjectId: null })
            }}
          />
        ) : (
          <span className="project-name">{project.name}</span>
        )}
        <span className="row-end">
          <GitMark git={s.git[project.id]} />
          <ActivityMark activity={activity} />
          <ServerMark projectId={project.id} />
          <span className="row-actions">
            {runTarget && !hasServer ? (
              <button
                className="icon-btn small"
                title={`Run ${runTarget.command}${runTarget.where ? ` in ${runTarget.where}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void s.runProject(project.id)
                }}
              >
                <Play />
              </button>
            ) : null}
            <button
              className="icon-btn small"
              title="New chat"
              onClick={(e) => {
                e.stopPropagation()
                s.newChat(project.id)
              }}
            >
              <MessageSquarePlus />
            </button>
            <button className="icon-btn small" title="More" onClick={menu}>
              <Ellipsis />
            </button>
          </span>
        </span>
      </div>
      {expanded ? (
        <div className="project-chats">
          {openTabs.map((t) => (
            <ChatRow key={t.id} tab={t} />
          ))}
          {visibleSaved.map((x) => (
            <ChatRow key={x.sessionId} session={x} />
          ))}
          {saved.length > 6 ? (
            <button className="chat-row more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show ${saved.length - 6} more`}
            </button>
          ) : null}
          {!openTabs.length && !saved.length ? (
            <button className="chat-row more" onClick={() => s.newChat(project.id)}>
              No chats yet. Start one
            </button>
          ) : null}
          <div className="project-chat-actions">
            <button className="mini-action" onClick={() => s.newChat(project.id)}>
              <Plus /> New chat
            </button>
            <button className="mini-action" onClick={() => s.newTerminal(project.id)}>
              <SquareTerminal /> Terminal
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GroupMark({ group }: { group: Group }): ReactNode {
  const icon = useStore((s) => {
    const borrowed = group.iconProjectId
    if (borrowed) return s.projects.some((p) => p.id === borrowed) ? s.icons[borrowed] : null
    return s.groupIcons[group.id]
  })
  return icon ? <img className="project-icon" src={icon} width={16} height={16} alt="" draggable={false} /> : null
}

function GroupBlock({
  group,
  projects,
  activity,
  sessionsByProject
}: {
  group: Group
  projects: Project[]
  activity: Record<string, Activity>
  sessionsByProject: Map<string, SessionSummary[]>
}): ReactNode {
  const s = useStore()
  const [over, setOver] = useState(false)
  // A drop that a project row takes never reaches the group: the highlight ends with any drag.
  useEffect(() => {
    if (!over) return
    const off = (): void => setOver(false)
    window.addEventListener('dragend', off)
    window.addEventListener('drop', off)
    return () => {
      window.removeEventListener('dragend', off)
      window.removeEventListener('drop', off)
    }
  }, [over])
  const collapsed = group.collapsed === true
  const editing = s.editingGroupId === group.id
  const groupActivity = projects.map((p) => activity[p.id]).find(Boolean) ?? null
  const fresh = s.watchNew[group.id] ?? []

  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const withIcons = projects.filter((p) => s.icons[p.id])
    const image = !group.iconProjectId && !!group.iconPath
    const parent = sharedParent(projects)
    const watchItem: MenuItem = group.watchPath
      ? { label: `Stop watching ${baseName(group.watchPath)} for new folders`, onSelect: () => s.unwatchFolder(group.id) }
      : parent
        ? { label: `Watch ${baseName(parent)} for new folders`, onSelect: () => void s.watchFolder(group.id, parent) }
        : {
            label: 'Watch a folder for new projects…',
            onSelect: async () => {
              const path = await window.loom.pickFolder()
              if (path) void s.watchFolder(group.id, path)
            }
          }
    s.showMenu(e, [
      { label: 'Add project folder…', onSelect: () => void s.pickAndAddProject(group.id) },
      watchItem,
      { label: 'Rename group', onSelect: () => s.set({ editingGroupId: group.id }) },
      {
        label: 'Icon',
        submenu: [
          withIcons.length
            ? {
                label: "Use a project's icon",
                checked: !!group.iconProjectId,
                submenu: withIcons.map((p) => ({
                  label: p.name,
                  checked: group.iconProjectId === p.id,
                  onSelect: () => s.updateGroup(group.id, { iconProjectId: p.id, iconPath: undefined })
                }))
              }
            : { label: 'None of its projects has an icon yet', disabled: true },
          {
            label: image ? 'Choose another image…' : 'Choose an image…',
            checked: image,
            onSelect: async () => {
              const path = await window.loom.pickIcon('Choose an icon for this group')
              if (path) s.updateGroup(group.id, { iconPath: path, iconProjectId: undefined })
            }
          },
          {
            label: 'No icon',
            checked: !group.iconProjectId && !group.iconPath,
            onSelect: () => s.updateGroup(group.id, { iconProjectId: undefined, iconPath: undefined })
          }
        ]
      },
      { separator: true, label: '' },
      { label: 'Delete group…', danger: true, onSelect: () => void s.requestDeleteGroup(group.id) }
    ])
  }

  return (
    <section
      className={`group${over ? ' drop-into' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('loom/project')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        const id = e.dataTransfer.getData('loom/project')
        if (id) s.moveProject(id, group.id)
      }}
    >
      <div
        className="group-row"
        role="button"
        tabIndex={0}
        onClick={() => s.updateGroup(group.id, { collapsed: !collapsed })}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            s.updateGroup(group.id, { collapsed: !collapsed })
          }
        }}
        onContextMenu={menu}
        aria-expanded={!collapsed}
      >
        <ChevronRight className={`chev${collapsed ? '' : ' open'}`} />
        <GroupMark group={group} />
        {editing ? (
          <InlineEdit
            value={group.name}
            onDone={(v) => {
              if (v) s.updateGroup(group.id, { name: v })
              s.set({ editingGroupId: null })
            }}
          />
        ) : (
          <span className="group-name">{group.name}</span>
        )}
        <span className="row-end">
          {collapsed ? <ActivityMark activity={groupActivity} /> : null}
          {collapsed && fresh.length ? (
            <span className="watch-dot" title={fresh.length === 1 ? '1 new folder to add' : `${fresh.length} new folders to add`} />
          ) : null}
          <span className="group-count">{projects.length}</span>
          <span className="row-actions">
            <button
              className="icon-btn small"
              title="Add a project folder to this group"
              onClick={(e) => {
                e.stopPropagation()
                void s.pickAndAddProject(group.id)
              }}
            >
              <Plus />
            </button>
            <button className="icon-btn small" title="More" onClick={menu}>
              <Ellipsis />
            </button>
          </span>
        </span>
      </div>
      {!collapsed ? (
        <div className="group-projects">
          {fresh.length ? <NewFolders group={group} folders={fresh} /> : null}
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} activity={activity[p.id] ?? null} sessions={sessionsByProject.get(p.id) ?? []} />
          ))}
          {!projects.length ? <p className="group-empty">Drag projects here, or use the plus button.</p> : null}
        </div>
      ) : null}
    </section>
  )
}

/** The folder all of a group's projects sit in, when they share one. */
function sharedParent(projects: Project[]): string | null {
  const parents = projects.map((p) => p.path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, ''))
  if (!parents.length || !parents[0]) return null
  return parents.every((x) => normPath(x) === normPath(parents[0])) ? parents[0] : null
}

/** Folders that appeared in the group's watched folder, each a click away from being a project. */
function NewFolders({ group, folders }: { group: Group; folders: SubFolder[] }): ReactNode {
  const s = useStore.getState()
  const where = baseName(group.watchPath ?? '')
  return (
    <div className="watch-new" role="group" aria-label={`New folders in ${where}`}>
      <div className="watch-head">
        <span className="watch-title">{folders.length === 1 ? `New in ${where}` : `${folders.length} new in ${where}`}</span>
        {folders.length > 1 ? (
          <button className="watch-link" onClick={() => s.addWatched(group.id, folders)}>
            Add all
          </button>
        ) : null}
        <button className="icon-btn small" title="Not now. They won't be offered again." aria-label="Hide these" onClick={() => s.hideWatched(group.id, folders)}>
          <X />
        </button>
      </div>
      {folders.map((f) => (
        <button key={f.path} className="watch-row" title={`Add ${f.path} to ${group.name}`} onClick={() => s.addWatched(group.id, [f])}>
          <FolderPlus />
          <span className="watch-name">{f.name}</span>
        </button>
      ))}
    </div>
  )
}

export function Sidebar(): ReactNode {
  const projects = useStore((s) => s.projects)
  const groups = useStore((s) => s.groups)
  const sessions = useStore((s) => s.sessions)
  const activity = useProjectActivity()
  const [overLoose, setOverLoose] = useState(false)
  useEffect(() => {
    if (!overLoose) return
    const off = (): void => setOverLoose(false)
    window.addEventListener('dragend', off)
    window.addEventListener('drop', off)
    return () => {
      window.removeEventListener('dragend', off)
      window.removeEventListener('drop', off)
    }
  }, [overLoose])

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const x of sessions) {
      const p = projectForPath(projects, x.cwd)
      if (!p) continue
      if (!map.has(p.id)) map.set(p.id, [])
      map.get(p.id)!.push(x)
    }
    return map
  }, [sessions, projects])

  const loose = projects.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId))
  const s = useStore.getState()

  return (
    <aside className="sidebar">
      <LookVideo area="sidebar" />
      <div className="sidebar-scroll">
        <div className="sidebar-section-head">
          <span>Projects</span>
          <span className="row-actions always">
            <button className="icon-btn small" title="New group" onClick={() => s.addGroup('New group')}>
              <Layers />
            </button>
            <button className="icon-btn small" title="Add a project folder" onClick={() => void s.pickAndAddProject(null)}>
              <FolderPlus />
            </button>
          </span>
        </div>
        {groups.map((g) => (
          <GroupBlock
            key={g.id}
            group={g}
            projects={projects.filter((p) => p.groupId === g.id)}
            activity={activity}
            sessionsByProject={sessionsByProject}
          />
        ))}
        <div
          className={`loose${overLoose ? ' drop-into' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('loom/project')) return
            e.preventDefault()
            setOverLoose(true)
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverLoose(false)
          }}
          onDrop={(e) => {
            setOverLoose(false)
            const id = e.dataTransfer.getData('loom/project')
            if (id) s.moveProject(id, null)
          }}
        >
          {loose.map((p) => (
            <ProjectRow key={p.id} project={p} activity={activity[p.id] ?? null} sessions={sessionsByProject.get(p.id) ?? []} />
          ))}
        </div>
        {!projects.length ? (
          <div className="sidebar-empty">
            <p>Add the folders you work in. Each one keeps its own chats, files and terminals.</p>
            <button className="btn primary" onClick={() => void s.pickAndAddProject(null)}>
              <FolderPlus /> Add a project folder
            </button>
          </div>
        ) : null}
      </div>
      <div className="sidebar-foot">
        <button className="btn ghost foot-btn" onClick={() => s.openSettings()}>
          <Settings /> Settings
        </button>
      </div>
    </aside>
  )
}
