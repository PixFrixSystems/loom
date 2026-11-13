import { ChevronRight, FilePlus, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConfigFileInfo, DirEntry, Project } from '@shared/types'
import { joinPath, normPath, relPath, shortPath } from '../lib/paths'
import { useStore, type MenuItem } from '../store'
import { LookVideo } from './LookVideo'
import { FileIcon } from './FileIcon'
import { GitPanel } from './GitPanel'

const fileCache = new Map<string, Promise<string[]>>()
export function projectFileList(root: string, force = false): Promise<string[]> {
  if (force || !fileCache.has(root)) fileCache.set(root, window.loom.projectFiles(root).catch(() => []))
  return fileCache.get(root)!
}

/** Folders left open, by path: they stay open through refreshes and switching projects. */
const openFolders = new Set<string>()

/** What a right-click on a file or folder offers. */
function entryMenu(entry: DirEntry, project: Project, reveal: () => void): MenuItem[] {
  const s = useStore.getState()
  const copy = [
    { label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(entry.path) },
    { label: 'Copy relative path', onSelect: () => void navigator.clipboard.writeText(relPath(entry.path, project.path)) }
  ]
  const change: MenuItem[] = [
    { separator: true, label: '' },
    { label: 'Rename…', onSelect: () => void s.renameEntry(entry.path) },
    { label: 'Delete…', danger: true, onSelect: () => void s.trashEntry(entry.path, entry.isDir) }
  ]
  if (!entry.isDir) {
    return [{ label: 'Open', onSelect: () => s.openFile(entry.path, project.id) }, ...copy, { label: 'Show in File Explorer', onSelect: () => void window.loom.reveal(entry.path) }, ...change]
  }
  return [
    { label: 'New file…', onSelect: () => (reveal(), void s.createEntry(entry.path, 'file', project.id)) },
    { label: 'New folder…', onSelect: () => (reveal(), void s.createEntry(entry.path, 'folder', project.id)) },
    { label: 'Refresh', onSelect: () => s.bumpTree() },
    { separator: true, label: '' },
    { label: 'Open a terminal here', onSelect: () => s.newTerminal(project.id, entry.path) },
    { label: 'Show in File Explorer', onSelect: () => void window.loom.openPath(entry.path) },
    ...copy,
    ...change
  ]
}

function TreeNode({ entry, depth, project }: { entry: DirEntry; depth: number; project: Project }): ReactNode {
  const key = normPath(entry.path)
  const [open, setOpenState] = useState(() => openFolders.has(key))
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const version = useStore((s) => s.treeVersion)
  const activePath = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'file' ? t.path : null
  })
  const setOpen = (v: boolean): void => {
    if (v) openFolders.add(key)
    else openFolders.delete(key)
    setOpenState(v)
  }

  // Read again whenever files may have changed; the old list stays until the new one is in.
  useEffect(() => {
    if (!open || !entry.isDir) return
    let gone = false
    window.loom
      .listDir(entry.path)
      .then((c) => !gone && setChildren(c))
      .catch(() => !gone && setChildren([]))
    return () => {
      gone = true
    }
  }, [open, version, entry.path])

  const menu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    useStore.getState().showMenu(e, entryMenu(entry, project, () => setOpen(true)))
  }

  if (!entry.isDir) {
    return (
      <button
        className={`tree-row${activePath === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => useStore.getState().openFile(entry.path, project.id)}
        onContextMenu={menu}
        title={entry.path}
      >
        <span className="tree-chev" />
        <FileIcon name={entry.name} />
        <span className="tree-name">{entry.name}</span>
      </button>
    )
  }
  return (
    <>
      <button className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen(!open)} onContextMenu={menu} aria-expanded={open} title={entry.path}>
        <ChevronRight className={`tree-chev${open ? ' open' : ''}`} />
        <FileIcon name={entry.name} dir open={open} />
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
  const treeVersion = useStore((s) => s.treeVersion)

  useEffect(() => setRoot(null), [project.path])
  useEffect(() => {
    let gone = false
    window.loom
      .listDir(project.path)
      .then((r) => !gone && setRoot(r))
      .catch(() => !gone && setRoot([]))
    return () => {
      gone = true
    }
  }, [project.path, version, treeVersion])

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
            useStore.getState().bumpTree()
          }}
        >
          <RefreshCw />
        </button>
      </div>
      <div
        className="pane-scroll"
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          useStore.getState().showMenu(e, [
            { label: 'New file…', onSelect: () => void useStore.getState().createEntry(project.path, 'file', project.id) },
            { label: 'New folder…', onSelect: () => void useStore.getState().createEntry(project.path, 'folder', project.id) },
            { label: 'Refresh', onSelect: () => useStore.getState().bumpTree() }
          ])
        }}
      >
        {filter ? (
          !all ? (
            <p className="pane-note">Listing files…</p>
          ) : matches.length ? (
            matches.map((rel) => (
              <button key={rel} className="tree-row flat" onClick={() => useStore.getState().openFile(joinPath(project.path, rel), project.id)} title={rel}>
                <FileIcon name={rel.split('\\').pop() ?? rel} />
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
          {f.exists ? <FileIcon name={f.path.replace(/^.*[\\/]/, '')} /> : <FilePlus className="tree-icon" />}
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
      <LookVideo area="files" />
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
