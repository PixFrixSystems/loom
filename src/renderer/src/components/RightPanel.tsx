import { ChevronRight, FilePlus, FileText, Folder, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConfigFileInfo, DirEntry, Project } from '@shared/types'
import { joinPath, shortPath } from '../lib/paths'
import { useStore } from '../store'
import { GitPanel } from './GitPanel'

const fileCache = new Map<string, Promise<string[]>>()
export function projectFileList(root: string, force = false): Promise<string[]> {
  if (force || !fileCache.has(root)) fileCache.set(root, window.loom.projectFiles(root).catch(() => []))
  return fileCache.get(root)!
}

function TreeNode({ entry, depth, project }: { entry: DirEntry; depth: number; project: Project }): ReactNode {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const activePath = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t.path : null
  })

  useEffect(() => {
    if (open && !children) void window.loom.listDir(entry.path).then(setChildren).catch(() => setChildren([]))
  }, [open, children, entry.path])

  if (!entry.isDir) {
    return (
      <button
        className={`tree-row${activePath === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => useStore.getState().openFile(entry.path, project.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          useStore.getState().showMenu(e, [
            { label: 'Open', onSelect: () => useStore.getState().openFile(entry.path, project.id) },
            { label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(entry.path) },
            { label: 'Show in File Explorer', onSelect: () => void window.loom.reveal(entry.path) }
          ])
        }}
        title={entry.path}
      >
        <span className="tree-chev" />
        <FileText className="tree-icon" />
        <span className="tree-name">{entry.name}</span>
      </button>
    )
  }
  return (
    <>
      <button className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={entry.path}>
        <ChevronRight className={`tree-chev${open ? ' open' : ''}`} />
        {open ? <FolderOpen className="tree-icon dir" /> : <Folder className="tree-icon dir" />}
        <span className="tree-name">{entry.name}</span>
      </button>
      {open && children
        ? children.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} project={project} />)
        : null}
    </>
  )
}

function FilesPane({ project }: { project: Project }): ReactNode {
  const [root, setRoot] = useState<DirEntry[] | null>(null)
  const [filter, setFilter] = useState('')
  const [all, setAll] = useState<string[] | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setRoot(null)
    void window.loom.listDir(project.path).then(setRoot).catch(() => setRoot([]))
  }, [project.path, version])

  useEffect(() => {
    if (filter && !all) void projectFileList(project.path).then(setAll)
  }, [filter, all, project.path])

  useEffect(() => setAll(null), [project.path, version])

  const matches = useMemo(() => {
    if (!filter || !all) return []
    const q = filter.toLowerCase()
    return all.filter((f) => f.toLowerCase().includes(q)).slice(0, 300)
  }, [filter, all])

  return (
    <div className="pane">
      <div className="pane-tools">
        <input className="field" type="search" placeholder={`Find in ${project.name}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          className="icon-btn"
          title="Refresh"
          onClick={() => {
            void projectFileList(project.path, true)
            setVersion((v) => v + 1)
          }}
        >
          <RefreshCw />
        </button>
      </div>
      <div className="pane-scroll">
        {filter ? (
          !all ? (
            <p className="pane-note">Listing files…</p>
          ) : matches.length ? (
            matches.map((rel) => (
              <button key={rel} className="tree-row flat" onClick={() => useStore.getState().openFile(joinPath(project.path, rel), project.id)} title={rel}>
                <FileText className="tree-icon" />
                <span className="tree-name">{rel.split('\\').pop()}</span>
                <span className="tree-dir">{rel.includes('\\') ? rel.slice(0, rel.lastIndexOf('\\')) : ''}</span>
              </button>
            ))
          ) : (
            <p className="pane-note">No files match “{filter}”.</p>
          )
        ) : root ? (
          root.map((e) => <TreeNode key={e.path} entry={e} depth={0} project={project} />)
        ) : (
          <p className="pane-note">Loading…</p>
        )}
      </div>
    </div>
  )
}

function ClaudePane({ project }: { project: Project | null }): ReactNode {
  const [files, setFiles] = useState<ConfigFileInfo[]>([])
  const info = useStore((s) => s.info)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    void window.loom.configFiles(project?.path ?? null).then(setFiles)
  }, [project?.path, version])

  const open = async (f: ConfigFileInfo): Promise<void> => {
    if (!f.exists) {
      const starter = f.path.endsWith('.json') ? '{\n}\n' : ''
      const r = await window.loom.writeFile(f.path, starter)
      setVersion((v) => v + 1)
      if (!r.ok) return void useStore.getState().showToast(`Couldn't create ${f.label}: ${r.message ?? 'the file could not be written.'}`)
    }
    useStore.getState().openFile(f.path, project?.id ?? null)
  }

  const section = (title: string, list: ConfigFileInfo[]): ReactNode => (
    <section className="config-section">
      <h3>{title}</h3>
      {list.map((f) => (
        <button key={f.path} className={`config-row${f.exists ? '' : ' missing'}`} onClick={() => void open(f)} title={f.path}>
          {f.exists ? <FileText className="tree-icon" /> : <FilePlus className="tree-icon" />}
          <span className="tree-name">{f.label}</span>
          <span className="tree-dir">{f.exists ? shortPath(f.path, info?.homeDir).replace(/^.*[\\/](?=[^\\/]+$)/, '') : 'Create'}</span>
        </button>
      ))}
    </section>
  )

  return (
    <div className="pane pane-scroll">
      {project ? section(project.name, files.filter((f) => f.scope === 'project')) : null}
      {section('All projects', files.filter((f) => f.scope === 'global'))}
      <section className="config-section">
        <h3>Claude for Loom</h3>
        <p className="pane-note">
          Chats run with your Claude Code sign-in, settings, skills and hooks. Pick which Claude program runs them in{' '}
          <a onClick={() => useStore.getState().openSettings()}>Settings</a>.
        </p>
      </section>
    </div>
  )
}

export function RightPanel(): ReactNode {
  const s = useStore()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const project = s.projects.find((p) => p.id === tab?.projectId) ?? null
  const changeCount = project ? (s.gitChanges[project.id]?.files.length ?? s.git[project.id]?.changes ?? 0) : 0
  return (
    <aside className="rightpanel">
      <div className="pane-head">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={s.rightPanelView === 'files'} onClick={() => s.set({ rightPanelView: 'files' })}>
            Files
          </button>
          <button role="tab" aria-selected={s.rightPanelView === 'changes'} onClick={() => s.set({ rightPanelView: 'changes' })}>
            Git
            {changeCount ? <span className="seg-count">{changeCount}</span> : null}
          </button>
          <button role="tab" aria-selected={s.rightPanelView === 'claude'} onClick={() => s.set({ rightPanelView: 'claude' })}>
            Claude
          </button>
        </div>
        <button className="icon-btn" title="Close panel" onClick={() => s.set({ rightPanelOpen: false })}>
          <X />
        </button>
      </div>
      {s.rightPanelView === 'files' ? (
        project ? (
          <FilesPane key={project.id} project={project} />
        ) : (
          <p className="pane-note pad">Open a tab from a project to see its files here.</p>
        )
      ) : s.rightPanelView === 'changes' ? (
        project ? (
          <GitPanel key={project.id} project={project} />
        ) : (
          <p className="pane-note pad">Open a tab from a project to see its changes here.</p>
        )
      ) : (
        <ClaudePane project={project} />
      )}
    </aside>
  )
}
