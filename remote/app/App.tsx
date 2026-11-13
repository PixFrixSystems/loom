import { ArrowUp, ChevronLeft, ChevronRight, ImagePlus, Plus, Square, TriangleAlert, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { UsageLimit } from '@shared/types'
import { MAX_IMAGES, type RemoteChatSummary, type RemoteProject } from '@shared/remote'
import { timeAgo } from '@renderer/lib/paths'
import { Ask } from './Asks'
import { prepare, type Attached } from './images'
import { LinkScreen, Wordmark } from './LinkPage'
import { Picks } from './Picks'
import { go, useApp, type PhoneChat } from './state'
import { LiveThought, Markdown, Step, useTick } from './Steps'

/** A project's mark: its own icon when Loom found one, else its initial on its colour. */
function Tile({ project }: { project: RemoteProject | null | undefined }): ReactNode {
  const icon = useApp((s) => (project ? s.icons[project.id] : undefined))
  if (!project) return null
  if (icon) return <img className="tile is-icon" src={icon} alt="" decoding="async" />
  return (
    <span className="tile" style={{ background: `var(--t-${project.color})` }} aria-hidden="true">
      {project.name.trim()[0]?.toUpperCase() ?? ''}
    </span>
  )
}

// ---------- Connection ----------

function ConnBanner(): ReactNode {
  const conn = useApp((s) => s.conn)
  const retry = useApp((s) => s.retry)
  const unlink = useApp((s) => s.unlink)
  if (conn === 'online') return null
  return (
    <div className={`banner${conn === 'connecting' ? '' : ' is-warn'}`} role="status">
      {conn === 'connecting' ? (
        <span>Connecting</span>
      ) : conn === 'pc-offline' ? (
        <span>Your PC isn&apos;t reachable. Loom has to be open on it, with the PC awake and online.</span>
      ) : conn === 'elsewhere' ? (
        <>
          <span>Loom is open in another tab on this phone.</span>
          <button className="btn" onClick={retry}>
            Use it here
          </button>
        </>
      ) : (
        <>
          <span>Loom on your PC doesn&apos;t know this phone any more. It may have been removed there.</span>
          <button className="btn" onClick={() => void unlink()}>
            Unlink this phone
          </button>
        </>
      )}
    </div>
  )
}

// ---------- Projects and chats ----------

function chatMeta(c: RemoteChatSummary): ReactNode {
  if (c.needsYou) return <span className="tag is-needs">Needs you</span>
  if (c.working) {
    return (
      <span className="tag is-working">
        <span className="live-dot" /> Working
      </span>
    )
  }
  if (c.status === 'error') return <span className="tag is-error">Stopped on an error</span>
  return c.lastAt ? <span className="when">{timeAgo(c.lastAt)}</span> : null
}

/** A chat open in Loom. On the first screen it carries its project's mark. */
function ChatRow({ c, project }: { c: RemoteChatSummary; project?: RemoteProject | null }): ReactNode {
  return (
    <a className={`row${c.unread ? ' is-unread' : ''}`} href={`#/c/${encodeURIComponent(c.tabId)}`}>
      {project !== undefined ? project ? <Tile project={project} /> : <span className="tile is-none" aria-hidden="true" /> : null}
      <span className="row-text">
        <span className="row-title">{c.title}</span>
        {c.preview ? <span className="row-preview">{c.preview}</span> : null}
      </span>
      <span className="row-meta">{chatMeta(c)}</span>
    </a>
  )
}

/** Chats that need an answer come first, then the ones at work, then the latest. */
function rank(c: RemoteChatSummary): number {
  return c.needsYou ? 0 : c.working ? 1 : 2
}

function byUrgency(a: RemoteChatSummary, b: RemoteChatSummary): number {
  return rank(a) - rank(b) || (b.lastAt ?? 0) - (a.lastAt ?? 0)
}

function ProjectRow({ p, open }: { p: RemoteProject; open: RemoteChatSummary[] }): ReactNode {
  const meta = open.some((c) => c.needsYou) ? (
    <span className="tag is-needs">Needs you</span>
  ) : open.some((c) => c.working) ? (
    <span className="tag is-working">
      <span className="live-dot" /> Working
    </span>
  ) : open.length ? (
    <span className="when">{open.length} open</span>
  ) : p.lastAt ? (
    <span className="when">{timeAgo(p.lastAt)}</span>
  ) : null
  return (
    <a className="row is-project" href={`#/p/${encodeURIComponent(p.id)}`}>
      <Tile project={p} />
      <span className="row-text">
        <span className="row-title">{p.name}</span>
      </span>
      <span className="row-meta">{meta}</span>
    </a>
  )
}

/** The projects that are in no group, as a folder of their own */
const LOOSE = '(none)'
const FOLDED_KEY = 'loom-folded'

function savedFolded(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Which folders are folded shut on this phone. Kept between visits; Loom's own sidebar is not touched. */
function useFolded(): { folded: Set<string>; toggle: (id: string) => void } {
  const [ids, setIds] = useState(savedFolded)
  const toggle = (id: string): void =>
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
      } catch {
        // No storage (private browsing): it still folds, until the page is closed.
      }
      return next
    })
  return { folded: new Set(ids), toggle }
}

/**
 * A group of projects, as Loom's sidebar has them: its name folds the projects away. Folded, it
 * still says how many it holds and whether any of their chats needs you or is at work.
 */
function Folder({
  id,
  name,
  projects,
  openIn,
  folded,
  onToggle
}: {
  id: string
  name: string
  projects: RemoteProject[]
  openIn: (projectId: string) => RemoteChatSummary[]
  folded: boolean
  onToggle: () => void
}): ReactNode {
  const open = projects.flatMap((p) => openIn(p.id))
  const body = `folder-${id}`
  return (
    <div className="subgroup">
      <h3 className="fold-head">
        <button className="fold" aria-expanded={!folded} aria-controls={folded ? undefined : body} onClick={onToggle}>
          <ChevronRight className={`chev${folded ? '' : ' is-open'}`} />
          <span className="fold-name">{name}</span>
          {folded ? (
            <span className="fold-meta">
              {open.some((c) => c.needsYou) ? (
                <span className="tag is-needs">Needs you</span>
              ) : open.some((c) => c.working) ? (
                <span className="tag is-working">
                  <span className="live-dot" /> Working
                </span>
              ) : null}
              <span>{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
            </span>
          ) : null}
        </button>
      </h3>
      {folded ? null : (
        <div id={body}>
          {projects.map((p) => (
            <ProjectRow key={p.id} p={p} open={openIn(p.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Meter({ l }: { l: UsageLimit }): ReactNode {
  const level = l.severity === 'critical' ? 'stop' : l.severity === 'warning' ? 'warn' : 'ok'
  return (
    <div className="meter">
      <span className="meter-label">{l.label}</span>
      <span className={`meter-bar is-${level}`}>
        <span className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, l.percent))}%` }} />
      </span>
      <span className="meter-value">{Math.round(l.percent)}%</span>
    </div>
  )
}

function HomeScreen(): ReactNode {
  const list = useApp((s) => s.list)
  const pc = useApp((s) => s.pc)
  const conn = useApp((s) => s.conn)
  const unlink = useApp((s) => s.unlink)
  const [asking, setAsking] = useState(false)
  const { folded, toggle } = useFolded()

  const projects = list?.projects ?? []
  const chats = [...(list?.chats ?? [])].sort(byUrgency)
  const openIn = (id: string): RemoteChatSummary[] => chats.filter((c) => c.projectId === id)
  const loose = projects.filter((p) => !p.groupId)
  const limits = list?.usage?.available ? list.usage.limits : []

  return (
    <div className="screen">
      <header className="bar">
        <Wordmark />
        {pc ? (
          <span className="pc" title={conn === 'online' ? 'Connected to this PC' : 'Not connected'}>
            <span className={conn === 'online' ? 'live-dot' : 'dot-off'} />
            {pc}
          </span>
        ) : null}
      </header>
      <ConnBanner />
      <main className="list">
        {!list ? (
          <p className="empty">{conn === 'online' ? 'Getting your projects.' : 'Your projects show here once this phone reaches your PC.'}</p>
        ) : (
          <>
            <section className="group">
              <h2>Open in Loom</h2>
              {chats.length ? (
                chats.map((c) => <ChatRow key={c.tabId} c={c} project={projects.find((p) => p.id === c.projectId) ?? null} />)
              ) : (
                <p className="hint">No chats are open in Loom right now. Pick a project to continue one of its chats or start a new one.</p>
              )}
            </section>
            <section className="group">
              <h2>Projects</h2>
              {!projects.length ? <p className="hint">Loom has no projects yet. Add a project folder on your PC.</p> : null}
              {(list.groups ?? []).map((g) => (
                <Folder key={g.id} id={g.id} name={g.name} projects={projects.filter((p) => p.groupId === g.id)} openIn={openIn} folded={folded.has(g.id)} onToggle={() => toggle(g.id)} />
              ))}
              {loose.length && list.groups?.length ? (
                <Folder id={LOOSE} name="Not in a group" projects={loose} openIn={openIn} folded={folded.has(LOOSE)} onToggle={() => toggle(LOOSE)} />
              ) : loose.length ? (
                // No groups in Loom: the projects are one plain list, with nothing to fold.
                <div className="subgroup">
                  {loose.map((p) => (
                    <ProjectRow key={p.id} p={p} open={openIn(p.id)} />
                  ))}
                </div>
              ) : null}
            </section>
          </>
        )}
        {limits.length ? (
          <section className="group">
            <h2>Plan limits</h2>
            <div className="meters">
              {limits.map((l) => (
                <Meter key={l.key} l={l} />
              ))}
            </div>
          </section>
        ) : null}
        <footer className="foot">
          {asking ? (
            <>
              <span>Unlink this phone? To use it again you&apos;d scan a new code.</span>
              <button className="btn danger" onClick={() => void unlink()}>
                Unlink
              </button>
              <button className="btn ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="link" onClick={() => setAsking(true)}>
              Unlink this phone
            </button>
          )}
        </footer>
      </main>
    </div>
  )
}

/** One project: start a chat, the chats it has open in Loom, and the ones in its history. */
function ProjectScreen({ id }: { id: string }): ReactNode {
  const list = useApp((s) => s.list)
  const saved = useApp((s) => s.saved[id])
  const opening = useApp((s) => s.opening)
  const conn = useApp((s) => s.conn)
  const openSaved = useApp((s) => s.openSaved)
  const newChat = useApp((s) => s.newChat)
  const project = list?.projects.find((p) => p.id === id)
  const open = (list?.chats ?? []).filter((c) => c.projectId === id).sort(byUrgency)
  const busy = !!opening && !opening.failed
  const off = conn !== 'online'

  return (
    <div className="screen">
      <header className="bar">
        <a className="back" href="#/" aria-label="Back to your projects">
          <ChevronLeft />
        </a>
        <Tile project={project} />
        <div className="bar-title">
          <div className="bar-name">{project?.name ?? 'Project'}</div>
        </div>
      </header>
      <ConnBanner />
      <main className="list">
        {list && !project ? (
          <p className="empty">
            This project is no longer in Loom. <a href="#/">Back to your projects</a>
          </p>
        ) : (
          <>
            <div className="project-actions">
              <button className="btn primary" disabled={off || busy} onClick={() => newChat(id)}>
                <Plus /> {opening?.what === `new:${id}` && !opening.failed ? 'Starting a chat' : 'New chat'}
              </button>
              {opening?.failed ? <span className="hint is-error">Loom couldn&apos;t open that. Try again.</span> : null}
            </div>
            {open.length ? (
              <section className="group">
                <h2>Open in Loom</h2>
                {open.map((c) => (
                  <ChatRow key={c.tabId} c={c} />
                ))}
              </section>
            ) : null}
            <section className="group">
              <h2>Earlier chats</h2>
              {!saved ? (
                <p className="hint">{off ? 'These show once the phone reaches your PC.' : "Getting this project's chats."}</p>
              ) : !saved.chats.length ? (
                <p className="hint">{open.length ? 'No other chats in this project.' : 'No chats in this project yet. Start the first one.'}</p>
              ) : (
                saved.chats.map((x) => (
                  <button key={x.sessionId} className="row" disabled={off || busy} onClick={() => openSaved(x.sessionId)}>
                    <span className="row-text">
                      <span className="row-title">{x.title}</span>
                    </span>
                    <span className="row-meta">{opening?.what === x.sessionId && !opening.failed ? 'Opening' : timeAgo(x.lastAt)}</span>
                  </button>
                ))
              )}
              {saved?.more ? <p className="hint">{saved.more === 1 ? '1 older chat is' : `${saved.more} older chats are`} in Loom on your PC.</p> : null}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

// ---------- A chat ----------

const FINE_POINTER = window.matchMedia('(pointer: fine)')

function Composer({ tabId, working, off }: { tabId: string; working: boolean; off: string | null }): ReactNode {
  const [text, setText] = useState('')
  const [images, setImages] = useState<Attached[]>([])
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const send = useApp((s) => s.send)
  const stopChat = useApp((s) => s.stopChat)
  const name = useApp((s) => {
    const state = s.chats[tabId]?.state
    return state?.agentName ?? (state?.provider === 'external' ? 'the agent' : 'Claude')
  })
  // Only a Loom that takes pictures with a message is offered them.
  const canAttach = useApp((s) => s.can.includes('images'))
  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])
  const submit = (): void => {
    const trimmed = text.trim()
    if ((!trimmed && !images.length) || off || adding) return
    if (send(tabId, trimmed, images)) {
      setText('')
      setImages([])
      setNote(null)
    }
  }
  /** Pictures picked from the phone's library or camera: made small enough to send, then shown. */
  const attach = async (files: FileList | null): Promise<void> => {
    const picked = [...(files ?? [])]
    if (picker.current) picker.current.value = ''
    if (!picked.length) return
    const room = Math.max(0, MAX_IMAGES - images.length)
    setAdding(true)
    const made = await Promise.all(picked.slice(0, room).map(prepare))
    const ready = made.filter((m): m is Attached => !!m)
    setImages((cur) => [...cur, ...ready].slice(0, MAX_IMAGES))
    const unread = made.length - ready.length
    setNote(
      picked.length > room
        ? `A message takes up to ${MAX_IMAGES} pictures, so ${picked.length - room === 1 ? 'one was' : `${picked.length - room} were`} left out.`
        : unread
          ? `${unread === 1 ? "One picture couldn't" : `${unread} pictures couldn't`} be read, so ${unread === 1 ? 'it was' : 'they were'} left out.`
          : null
    )
    setAdding(false)
  }
  return (
    <div className="composer">
      <Picks tabId={tabId} off={!!off} />
      {images.length || adding || note ? (
        <div className="attached">
          {images.map((image, i) => (
            <span key={image.id} className="attached-item">
              <img src={image.thumb} alt="" />
              <button type="button" className="attached-remove" aria-label={`Remove picture ${i + 1}`} onClick={() => setImages((cur) => cur.filter((x) => x.id !== image.id))}>
                <X />
              </button>
            </span>
          ))}
          {adding ? <span className="attached-note">Getting the picture ready</span> : null}
          {note && !adding ? (
            <span className="attached-note" role="status">
              {note}
            </span>
          ) : null}
        </div>
      ) : null}
      <form
        className="composer-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {canAttach ? (
          <>
            <input ref={picker} type="file" accept="image/*" multiple hidden tabIndex={-1} onChange={(e) => void attach(e.target.files)} />
            <button
              type="button"
              className="round is-attach"
              aria-label="Attach pictures"
              title="Attach pictures"
              disabled={!!off || adding || images.length >= MAX_IMAGES}
              onClick={() => picker.current?.click()}
            >
              <ImagePlus />
            </button>
          </>
        ) : null}
        <textarea
          ref={box}
          className="composer-box"
          rows={1}
          placeholder={off ?? (working ? 'Add a message' : `Message ${name}`)}
          aria-label="Message"
          disabled={!!off}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // With a keyboard, Enter sends and Shift+Enter starts a new line. On a phone, Enter is a new line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && FINE_POINTER.matches) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {working ? (
          <button type="button" className="round is-stop" aria-label={`Stop ${name}`} title={`Stop ${name}`} disabled={!!off} onClick={() => stopChat(tabId)}>
            <Square />
          </button>
        ) : null}
        <button type="submit" className="round is-send" aria-label="Send" title="Send" disabled={!!off || adding || (!text.trim() && !images.length)}>
          <ArrowUp />
        </button>
      </form>
    </div>
  )
}

function Working({ chat }: { chat: PhoneChat }): ReactNode {
  useTick(true)
  const since = chat.state?.startedAt
  const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0
  const tasks = chat.state?.tasks ?? []
  const name = chat.state?.agentName ?? (chat.state?.provider === 'external' ? 'The agent' : 'Claude')
  const what = chat.state?.activity === 'compacting' ? 'Summarizing the conversation' : `${name} is working`
  return (
    <div className="working">
      <div className="working-line">
        <span className="live-dot" />
        <span>{what}</span>
        {since ? <span className="working-time">{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}</span> : null}
      </div>
      {tasks.slice(0, 3).map((t) => (
        <div key={t.id} className="working-task">
          {t.agentType ? `${t.agentType}: ` : ''}
          {t.description}
        </div>
      ))}
      {tasks.length > 3 ? <div className="working-task">and {tasks.length - 3} more</div> : null}
    </div>
  )
}

function ChatScreen({ tabId }: { tabId: string }): ReactNode {
  const chat = useApp((s) => s.chats[tabId])
  const summary = useApp((s) => s.list?.chats.find((c) => c.tabId === tabId))
  const projects = useApp((s) => s.list?.projects)
  const conn = useApp((s) => s.conn)
  const respond = useApp((s) => s.respond)
  const more = useApp((s) => s.more)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = useRef({ first: '', height: 0 })

  const state = chat?.state
  const title = state?.title ?? summary?.title ?? 'Chat'
  const projectId = state?.projectId ?? summary?.projectId
  const project = projects?.find((p) => p.id === projectId)
  // Claude's own turn. Agents and background tasks can outlive it: the bar says so, and the chat
  // doesn't keep a line about them at the bottom.
  const working = !!state && (state.status === 'running' || state.status === 'starting')
  const agents = state?.tasks.length ?? 0
  const items = chat?.items ?? []
  const pending = new Set(chat?.pending)
  const firstId = items[0]?.id ?? ''

  // New steps keep the view at the bottom when it was there. Earlier steps arrive above what is
  // on screen: the view stays on the step it was showing.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    else if (last.current.first && firstId !== last.current.first) el.scrollTop += el.scrollHeight - last.current.height
    last.current = { first: firstId, height: el.scrollHeight }
  })

  const off = chat?.gone ? 'This chat was closed in Loom' : conn !== 'online' ? 'Not connected to your PC' : null

  return (
    <div className="screen">
      <header className="bar">
        <a className="back" href={project ? `#/p/${encodeURIComponent(project.id)}` : '#/'} aria-label={project ? `Back to ${project.name}` : 'Back to your projects'}>
          <ChevronLeft />
        </a>
        <div className="bar-title">
          <div className="bar-name">{title}</div>
          {project || state?.model ? <div className="bar-sub">{[project?.name, state?.model].filter(Boolean).join(', ')}</div> : null}
        </div>
        {agents ? (
          <span className="bar-agents" title={state?.tasks.map((t) => t.description).join('\n')}>
            <span className="live-dot" /> {agents === 1 ? '1 agent' : `${agents} agents`}
          </span>
        ) : null}
      </header>
      <ConnBanner />
      <div
        className="timeline"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {chat?.gone ? (
          <p className="empty">
            This chat was closed in Loom.{' '}
            <button className="link" onClick={() => go({ at: 'home' })}>
              Back to your projects
            </button>
          </p>
        ) : !chat?.loaded ? (
          <p className="empty">{conn === 'online' ? 'Opening the chat.' : 'This chat opens once the phone reaches your PC.'}</p>
        ) : (
          <>
            {chat.earlier > 0 ? (
              <button className="btn earlier" disabled={chat.askedEarlier || conn !== 'online'} onClick={() => more(tabId)}>
                {chat.askedEarlier ? 'Getting earlier steps' : 'Show earlier steps'}
              </button>
            ) : null}
            {!items.length && !working ? <p className="empty">Nothing here yet. Send the first message.</p> : null}
            {items.map((item) => (
              <Step key={item.id} item={item} pending={pending.has(item.id)} />
            ))}
            {chat.thinking ? <LiveThought text={chat.thinking.text} since={chat.thinking.since} /> : null}
            {chat.partial ? <Markdown text={chat.partial} /> : null}
            {state?.status === 'error' && state.error ? (
              <div className="note is-error">
                <div className="note-line">
                  <TriangleAlert />
                  <span>{state.error}</span>
                </div>
              </div>
            ) : null}
            {working && !state?.permissions.length ? <Working chat={chat} /> : null}
            {state?.permissions.map((req) => (
              <Ask key={req.requestId} req={req} external={state.provider === 'external'} name={state.agentName} answer={(r) => respond(tabId, req.requestId, r)} />
            ))}
          </>
        )}
      </div>
      <Composer tabId={tabId} working={working} off={off} />
    </div>
  )
}

export function App(): ReactNode {
  const phase = useApp((s) => s.phase.at)
  const route = useApp((s) => s.route)
  useEffect(() => {
    void useApp.getState().boot()
    const onHash = (): void => useApp.getState().onRoute()
    // Back in front after the phone slept or changed network: make sure the connection is alive.
    const onShow = (): void => {
      if (document.visibilityState === 'visible') useApp.getState().retry()
    }
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('online', onShow)
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('online', onShow)
    }
  }, [])
  if (phase === 'starting') return null
  if (phase !== 'linked') return <LinkScreen />
  if (route.at === 'chat') return <ChatScreen key={route.tabId} tabId={route.tabId} />
  if (route.at === 'project') return <ProjectScreen key={route.id} id={route.id} />
  return <HomeScreen />
}
