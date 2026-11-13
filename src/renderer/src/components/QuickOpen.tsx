import { MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionSummary } from '@shared/types'
import { joinPath, projectForPath, timeAgo } from '../lib/paths'
import { sessionKey } from '../lib/providers'
import { useStore } from '../store'
import { FileIcon } from './FileIcon'
import { ProjectMark } from './ProjectMark'
import { projectFileList } from './RightPanel'

function score(path: string, q: string): number {
  const p = path.toLowerCase()
  const name = p.slice(p.lastIndexOf('\\') + 1)
  if (name === q) return 100
  if (name.startsWith(q)) return 80
  if (name.includes(q)) return 60
  if (p.includes(q)) return 40
  // loose subsequence match
  let i = 0
  for (const ch of p) if (ch === q[i]) i++
  return i === q.length ? 10 : -1
}

/** The file name with the typed text lit where it appears in it. */
function lit(name: string, q: string): ReactNode {
  const lower = name.toLowerCase()
  // Some letters change length when lowercased; then the positions would not line up.
  const at = q && lower.length === name.length ? lower.indexOf(q) : -1
  if (at < 0) return name
  return (
    <>
      {name.slice(0, at)}
      <mark className="palette-match">{name.slice(at, at + q.length)}</mark>
      {name.slice(at + q.length)}
    </>
  )
}

/** A chat Ctrl+P can open: one open in a tab, or one saved in history. */
interface ChatHit {
  key: string
  title: string
  projectId: string | null
  projectName: string
  when: number
  tabId?: string
  session?: SessionSummary
}

/** How well a chat matches: by its title first, then by its project's name ("loom" finds Loom's chats). */
function chatScore(c: ChatHit, q: string): number {
  const title = c.title.toLowerCase()
  if (title.startsWith(q)) return 80
  if (title.includes(q)) return 60
  // Only whole runs of what you typed: loose letter-by-letter matches find too many chats.
  if (c.projectName.toLowerCase().includes(q)) return 40
  return -1
}

/** The last folder of a path, for chats from folders that aren't projects. */
function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

export function QuickOpen(): ReactNode {
  const s = useStore()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const [projectId, setProjectId] = useState(tab?.projectId ?? s.projects[0]?.id ?? null)
  const project = s.projects.find((p) => p.id === projectId) ?? null
  const [q, setQ] = useState('')
  const [files, setFiles] = useState<string[] | null>(null)
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const close = (): void => s.set({ quickOpen: false })
  const needle = q.trim().toLowerCase()

  const list = useRef<HTMLDivElement>(null)

  // Back to where the keyboard was when this closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => before?.focus?.({ preventScroll: true })
  }, [])

  // The last list right away, then a fresh one: files Claude just made show up too.
  useEffect(() => {
    setFiles(null)
    if (!project) return
    let gone = false
    void projectFileList(project.path).then((f) => !gone && setFiles(f))
    void projectFileList(project.path, true).then((f) => !gone && setFiles(f))
    return () => {
      gone = true
    }
  }, [project?.path])

  // Saved chats, freshly listed: a chat from a minute ago is findable too.
  useEffect(() => {
    void s.refreshSessions()
  }, [])

  // Every chat Loom knows of: open tabs, then saved ones not open, newest first.
  const allChats = useMemo(() => {
    const out: ChatHit[] = []
    const openIds = new Set<string>()
    for (const t of s.tabs) {
      if (t.kind !== 'chat') continue
      const key = sessionKey(t)
      if (t.sessionId) openIds.add(key)
      const p = s.projects.find((x) => x.id === t.projectId)
      const saved = t.sessionId ? s.sessions.find((x) => sessionKey(x) === key) : undefined
      out.push({ key: `tab:${t.id}`, title: t.title, projectId: t.projectId, projectName: p?.name ?? folderName(t.cwd), when: saved?.lastModified ?? Date.now(), tabId: t.id })
    }
    for (const x of s.sessions) {
      const key = sessionKey(x)
      if (openIds.has(key)) continue
      const p = projectForPath(s.projects, x.cwd)
      out.push({ key: `s:${key}`, title: x.title, projectId: p?.id ?? null, projectName: p?.name ?? folderName(x.cwd), when: x.lastModified, session: x })
    }
    return out.sort((a, b) => b.when - a.when)
  }, [s.tabs, s.sessions, s.projects])

  const chatResults = useMemo(() => {
    const query = q.trim().toLowerCase()
    // Nothing typed: this project's latest few chats, above its files.
    if (!query) return allChats.filter((c) => c.projectId === projectId).slice(0, 5)
    return allChats
      .map((c) => ({ c, sc: chatScore(c, query) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc || b.c.when - a.c.when)
      .slice(0, 12)
      .map((x) => x.c)
  }, [allChats, q, projectId])

  const results = useMemo(() => {
    if (!files) return []
    const query = q.trim().toLowerCase().replace(/\//g, '\\')
    if (!query) return files.slice(0, 60)
    return files
      .map((f) => ({ f, sc: score(f, query) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc || a.f.length - b.f.length)
      .slice(0, 60)
      .map((x) => x.f)
  }, [files, q])

  // One list for the keyboard: the chats, then the files.
  const rows: ({ kind: 'chat'; chat: ChatHit } | { kind: 'file'; rel: string })[] = [
    ...chatResults.map((chat) => ({ kind: 'chat' as const, chat })),
    ...results.map((rel) => ({ kind: 'file' as const, rel }))
  ]

  useEffect(() => setIndex(0), [q, projectId])
  useEffect(() => {
    list.current?.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (rel: string): void => {
    if (!project) return
    s.openFile(joinPath(project.path, rel), project.id)
    close()
  }
  const openChat = (c: ChatHit): void => {
    if (c.tabId) s.activate(c.tabId)
    else if (c.session) s.openSession(c.session)
    close()
  }
  const pick = (i: number): void => {
    const row = rows[i]
    if (!row) return
    if (row.kind === 'chat') openChat(row.chat)
    else choose(row.rel)
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Open a chat or a file">
        <div className="palette-input">
          <input
            ref={input}
            className="field"
            placeholder={project ? `Open a chat, or a file in ${project.name}` : 'Open a chat'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') pick(index)
              else if (e.key === 'Tab' && s.projects.length > 1) {
                e.preventDefault()
                const i = s.projects.findIndex((p) => p.id === projectId)
                setProjectId(s.projects[(i + (e.shiftKey ? s.projects.length - 1 : 1)) % s.projects.length].id)
              }
            }}
          />
          {project ? (
            <span className="palette-project">
              <ProjectMark project={project} size={14} />
              {project.name}
              {s.projects.length > 1 ? <kbd>Tab</kbd> : null}
            </span>
          ) : null}
        </div>
        <div ref={list} className="palette-list" role="listbox">
          {chatResults.length ? <div className="palette-group">Chats</div> : null}
          {chatResults.map((c, i) => (
            <button
              key={c.key}
              role="option"
              aria-selected={i === index}
              className={`palette-row${i === index ? ' active' : ''}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => openChat(c)}
            >
              <MessageSquare className="tree-icon" />
              <span className="tree-name">{lit(c.title, needle)}</span>
              <span className="tree-dir palette-chat-where">
                {c.projectName ? `${c.projectName}, ` : ''}
                {c.tabId ? 'open' : timeAgo(c.when)}
              </span>
            </button>
          ))}
          {chatResults.length && (results.length || !files) ? <div className="palette-group">Files</div> : null}
          {!files && project ? <p className="pane-note pad">Listing files…</p> : null}
          {files && !results.length && !chatResults.length ? <p className="pane-note pad">Nothing matches.</p> : null}
          {results.map((rel, fi) => {
            const i = chatResults.length + fi
            return (
            <button
              key={rel}
              role="option"
              aria-selected={i === index}
              className={`palette-row${i === index ? ' active' : ''}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => choose(rel)}
            >
              <FileIcon name={rel.slice(rel.lastIndexOf('\\') + 1)} />
              <span className="tree-name">{lit(rel.slice(rel.lastIndexOf('\\') + 1), needle)}</span>
              <span className="tree-dir">{rel.includes('\\') ? rel.slice(0, rel.lastIndexOf('\\')) : ''}</span>
            </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
