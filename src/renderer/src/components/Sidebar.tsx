import {
  ChevronRight,
  Ellipsis,
  FolderPlus,
  Layers,
  LoaderCircle,
  MessageSquarePlus,
  Play,
  Plus,
  Settings,
  SquareTerminal
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { THREAD_COLORS, type ChatTab, type Group, type Project, type SessionSummary } from '@shared/types'
import { projectForPath, timeAgo } from '../lib/paths'
import { useStore, type MenuItem } from '../store'
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
      const a: Activity = c.permissions.length ? 'waiting' : c.status === 'running' || c.status === 'starting' ? 'running' : c.unread ? 'unread' : null
      const rank = { waiting: 3, running: 2, unread: 1 } as const
      const cur = out[t.projectId]
      if (a && (!cur || rank[a] > rank[cur])) out[t.projectId] = a
    }
    return out
  }, [tabs, chats])
}

function ActivityMark({ activity }: { activity: Activity }): ReactNode {
  if (activity === 'running') return <LoaderCircle className="spin activity" aria-label="Claude is working" />
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
    if (tab) items.push({ label: 'Close tab', onSelect: () => useStore.getState().closeTab(tab.id) })
    const id = tab?.sessionId ?? session?.sessionId
    if (id) items.push({ separator: true, label: '' }, { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(id) })
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
            label: 'No icon, show the colour thread',
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
      { label: 'Remove from Loom', danger: true, onSelect: () => s.removeProject(project.id) }
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
        if (!id || id === project.id) return
        e.preventDefault()
        e.stopPropagation()
        s.moveProject(id, project.groupId, project.id)
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
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            s.updateProject(project.id, { collapsed: expanded })
          }
        }}
        onContextMenu={menu}
        title={project.path}
      >
        <ChevronRight className="chev" />
        <ProjectMark project={project} fallback="project-thread" />
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
  const collapsed = group.collapsed === true
  const editing = s.editingGroupId === group.id
  const groupActivity = projects.map((p) => activity[p.id]).find(Boolean) ?? null

  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const withIcons = projects.filter((p) => s.icons[p.id])
    const image = !group.iconProjectId && !!group.iconPath
    s.showMenu(e, [
      { label: 'Add project folder…', onSelect: () => void s.pickAndAddProject(group.id) },
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
      { label: 'Delete group', danger: true, onSelect: () => s.deleteGroup(group.id) }
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
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} activity={activity[p.id] ?? null} sessions={sessionsByProject.get(p.id) ?? []} />
          ))}
          {!projects.length ? <p className="group-empty">Drag projects here, or use the plus button.</p> : null}
        </div>
      ) : null}
    </section>
  )
}

export function Sidebar(): ReactNode {
  const projects = useStore((s) => s.projects)
  const groups = useStore((s) => s.groups)
  const sessions = useStore((s) => s.sessions)
  const activity = useProjectActivity()
  const [overLoose, setOverLoose] = useState(false)

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
