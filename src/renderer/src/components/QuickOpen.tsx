import { FileText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { joinPath } from '../lib/paths'
import { useStore } from '../store'
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

  useEffect(() => setIndex(0), [q, projectId])
  useEffect(() => {
    list.current?.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (rel: string): void => {
    if (!project) return
    s.openFile(joinPath(project.path, rel), project.id)
    close()
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Open a file">
        <div className="palette-input">
          <input
            ref={input}
            className="field"
            placeholder={project ? `Open a file in ${project.name}` : 'Add a project first'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter' && results[index]) choose(results[index])
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
          {!files && project ? <p className="pane-note pad">Listing files…</p> : null}
          {files && !results.length ? <p className="pane-note pad">Nothing matches.</p> : null}
          {results.map((rel, i) => (
            <button
              key={rel}
              role="option"
              aria-selected={i === index}
              className={`palette-row${i === index ? ' active' : ''}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => choose(rel)}
            >
              <FileText className="tree-icon" />
              <span className="tree-name">{lit(rel.slice(rel.lastIndexOf('\\') + 1), needle)}</span>
              <span className="tree-dir">{rel.includes('\\') ? rel.slice(0, rel.lastIndexOf('\\')) : ''}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
