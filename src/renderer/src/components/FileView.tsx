import { FolderOpen, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FileTab } from '@shared/types'
import { languageFor, relPath } from '../lib/paths'
import { monaco } from '../lib/monaco'
import { fileSavers, liveDrafts, useStore } from '../store'
import { mediaKind } from '@shared/media'
import { MediaView } from './MediaView'
import { ProjectMark } from './ProjectMark'

type Load =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'unavailable'; message: string }

/** A file in a tab: pictures, videos and sound are shown; everything else opens as text to edit. */
export function FileView({ tab, active, visible = active }: { tab: FileTab; active: boolean; visible?: boolean }): ReactNode {
  return mediaKind(tab.path) ? <MediaView tab={tab} visible={visible} /> : <TextFileView tab={tab} active={active} visible={visible} />
}

function TextFileView({ tab, active, visible = active }: { tab: FileTab; active: boolean; visible?: boolean }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const saved = useRef('')
  /** The editor's version at the last save or load; the file is unsaved whenever they differ. */
  const savedVersion = useRef(0)
  const eol = useRef<'lf' | 'crlf'>('lf')
  const bom = useRef(false)
  /** How the file is saved (UTF-8, UTF-16, an older Windows code page): it is written back the same way */
  const encoding = useRef('utf-8')
  const [encodingShown, setEncodingShown] = useState<string | null>(null)
  const mtime = useRef<number>(0)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [changedOnDisk, setChangedOnDisk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const dirty = useStore((s) => !!s.dirtyFiles[tab.id])

  const setDirty = useCallback(
    (d: boolean) => {
      const cur = !!useStore.getState().dirtyFiles[tab.id]
      if (cur !== d) useStore.setState((s) => ({ dirtyFiles: { ...s.dirtyFiles, [tab.id]: d } }))
    },
    [tab.id]
  )

  const read = useCallback(async () => {
    const r = await window.loom.readFile(tab.path)
    if (!r.ok) {
      const message =
        r.reason === 'missing'
          ? 'This file does not exist (yet).'
          : r.reason === 'binary'
            ? 'This is a binary file, so it cannot be edited here.'
            : r.reason === 'too-large'
              ? `This file is ${(r.size! / 1048576).toFixed(1)} MB, too large to edit here.`
              : r.reason === 'encoding'
                ? "This file isn't saved as UTF-8 (it may use an older Windows encoding). Loom won't edit it, because saving would damage its text."
                : `This file could not be opened. ${r.message ?? ''}`
      setLoad({ state: 'unavailable', message })
      return null
    }
    saved.current = r.content
    eol.current = r.eol
    bom.current = r.bom
    encoding.current = r.encoding
    setEncodingShown(r.encoding === 'utf-8' ? null : r.encoding === 'utf-16le' ? 'UTF-16 LE' : r.encoding === 'utf-16be' ? 'UTF-16 BE' : r.encoding.replace(/^windows-/, 'Windows-'))
    mtime.current = r.mtime
    return r.content
  }, [tab.path])

  useEffect(() => {
    let disposed = false
    void read().then((content) => {
      if (disposed || content === null || !host.current) return
      const uri = monaco.Uri.file(tab.path)
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageFor(tab.path), uri)
      model.setEOL(eol.current === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
      const ed = monaco.editor.create(host.current, {
        model,
        theme: 'loom',
        automaticLayout: true,
        fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding: { top: 10 },
        wordWrap: languageFor(tab.path) === 'markdown' ? 'on' : 'off',
        stickyScroll: { enabled: false },
        // A file dropped on the editor opens in a tab (the window handles it), not typed in as a path.
        dropIntoEditor: { enabled: false },
        fixedOverflowWidgets: true
      })
      editor.current = ed
      saved.current = ed.getValue()
      savedVersion.current = model.getAlternativeVersionId()
      ed.onDidChangeModelContent(() => setDirty(model.getAlternativeVersionId() !== savedVersion.current))
      // Unsaved edits that came along when this tab moved from another window.
      const draft = useStore.getState().fileDrafts[tab.id]
      if (draft !== undefined) {
        model.setValue(draft)
        useStore.setState((st) => {
          const fileDrafts = { ...st.fileDrafts }
          delete fileDrafts[tab.id]
          return { fileDrafts }
        })
      }
      liveDrafts.set(tab.id, () => (ed.getValue() !== saved.current ? ed.getValue() : null))
      setLoad({ state: 'ready' })
    })
    return () => {
      disposed = true
      const ed = editor.current
      editor.current = null
      liveDrafts.delete(tab.id)
      fileSavers.delete(tab.id)
      // Leaving this window with unsaved edits: keep them for whichever window shows the tab next.
      if (ed && ed.getValue() !== saved.current && useStore.getState().tabs.some((t) => t.id === tab.id)) {
        const text = ed.getValue()
        useStore.setState((st) => ({ fileDrafts: { ...st.fileDrafts, [tab.id]: text } }))
      }
      ed?.getModel()?.dispose()
      ed?.dispose()
    }
  }, [tab.path])

  /** Saves; `overwrite` replaces a version that changed on disk. False when nothing was written. */
  const save = useCallback(
    async (overwrite = false): Promise<boolean> => {
      const ed = editor.current
      const model = ed?.getModel()
      if (!ed || !model) return false
      // Take the text now: anything typed while the write runs stays unsaved.
      const text = ed.getValue()
      const version = model.getAlternativeVersionId()
      const value = model.getValue(eol.current === 'crlf' ? monaco.editor.EndOfLinePreference.CRLF : monaco.editor.EndOfLinePreference.LF)
      setSaving(true)
      setSaveError(null)
      try {
        const r = await window.loom.writeFile(tab.path, value, { bom: bom.current, encoding: encoding.current, expectMtime: overwrite ? undefined : mtime.current })
        if (!r.ok) {
          if (r.reason === 'changed') setChangedOnDisk(true)
          else setSaveError(r.message ?? 'The file could not be written.')
          return false
        }
        mtime.current = r.mtime
        saved.current = text
        savedVersion.current = version
        setDirty(model.getAlternativeVersionId() !== version)
        setChangedOnDisk(false)
        return true
      } finally {
        setSaving(false)
      }
    },
    [tab.path, setDirty]
  )
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    fileSavers.set(tab.id, () => saveRef.current())
  }, [tab.id])

  const reload = useCallback(async () => {
    const content = await read()
    const ed = editor.current
    const model = ed?.getModel()
    if (content === null || !ed || !model) return
    // An edit rather than a reset: the cursor, scroll and undo history survive a reload.
    const view = ed.saveViewState()
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
    model.setEOL(eol.current === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    if (view) ed.restoreViewState(view)
    saved.current = ed.getValue()
    savedVersion.current = model.getAlternativeVersionId()
    setDirty(false)
    setChangedOnDisk(false)
    setSaveError(null)
  }, [read, setDirty])

  // Ctrl+S
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !useStore.getState().confirm) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, save])

  useEffect(() => {
    if (active && load.state === 'ready' && !useStore.getState().pointerFocus) editor.current?.focus()
  }, [active, load.state])

  // While the file is on screen, pick up changes Claude made on disk.
  useEffect(() => {
    if (!visible || load.state !== 'ready') return
    const check = async (): Promise<void> => {
      const m = await window.loom.fileMtime(tab.path)
      if (m && mtime.current && m > mtime.current + 1) {
        if (useStore.getState().dirtyFiles[tab.id]) setChangedOnDisk(true)
        else void reload()
      }
    }
    void check()
    const t = setInterval(check, 3000)
    return () => clearInterval(t)
  }, [visible, load.state, tab.path, reload])

  return (
    <div className="fileview">
      <div className="file-head">
        <ProjectMark project={project} />
        {project ? <span className="chat-head-project">{project.name}</span> : null}
        <span className="chat-head-path selectable" title={tab.path}>
          {project ? relPath(tab.path, project.path) : tab.path}
        </span>
        <span className="chat-head-spacer" />
        {changedOnDisk ? (
          <span className="file-conflict" role="status">
            Changed on disk while you were editing
            <button className="btn" onClick={() => void reload()}>
              <RefreshCw /> Reload from disk
            </button>
            <button className="btn" onClick={() => void save(true)}>
              Overwrite with mine
            </button>
          </span>
        ) : saveError ? (
          <span className="file-conflict" role="alert" title={saveError}>
            Couldn't save: {saveError}
          </span>
        ) : null}
        {encodingShown ? (
          <span className="file-encoding" title={`This file is saved as ${encodingShown} rather than UTF-8. Loom reads it and saves it that way, so nothing else that uses it breaks.`}>
            {encodingShown}
          </span>
        ) : null}
        <button className="icon-btn" title="Show in File Explorer" onClick={() => void window.loom.reveal(tab.path)}>
          <FolderOpen />
        </button>
        <button className="btn" disabled={!dirty || saving} onClick={() => void save()} title="Save (Ctrl+S)">
          <Save /> {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {load.state === 'unavailable' ? (
        <div className="file-unavailable">
          <p>{load.message}</p>
          <button className="btn" onClick={() => void window.loom.openPath(tab.path)}>
            Open with the default app
          </button>
        </div>
      ) : null}
      <div ref={host} className="editor-host" hidden={load.state === 'unavailable'} />
    </div>
  )
}
