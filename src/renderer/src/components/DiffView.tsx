import { FileText, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DiffTab } from '@shared/types'
import { monaco } from '../lib/monaco'
import { languageFor, relPath } from '../lib/paths'
import { useStore } from '../store'
import { ProjectMark } from './ProjectMark'

type State = 'loading' | 'ready' | 'same' | 'binary' | 'error'

/** A file before and after, side by side: since the last commit, or in one commit. */
export function DiffView({ tab, visible = true }: { tab: DiffTab; active: boolean; visible?: boolean }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<{ before: monaco.editor.ITextModel; after: monaco.editor.ITextModel } | null>(null)
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState('')
  const project = useStore((s) => s.projects.find((p) => p.id === tab.projectId))
  const dir = project?.path ?? tab.path.replace(/[\\/][^\\/]*$/, '')

  const load = useCallback(async () => {
    const r = await window.loom.gitDiff(dir, tab.path, tab.commit ?? null)
    if (r.error) {
      setError(r.error)
      setState('error')
      return
    }
    if (r.binary) {
      setState('binary')
      return
    }
    if (!models.current) {
      const lang = languageFor(tab.path)
      models.current = { before: monaco.editor.createModel(r.before, lang), after: monaco.editor.createModel(r.after, lang) }
    } else {
      if (models.current.before.getValue() !== r.before) models.current.before.setValue(r.before)
      if (models.current.after.getValue() !== r.after) models.current.after.setValue(r.after)
    }
    if (!editor.current && host.current) {
      const ed = monaco.editor.createDiffEditor(host.current, {
        theme: 'loom',
        automaticLayout: true,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 640,
        fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        stickyScroll: { enabled: false },
        fixedOverflowWidgets: true,
        // Long unchanged stretches fold away, so the changes are what you see.
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5, revealLineCount: 20 }
      })
      ed.setModel({ original: models.current.before, modified: models.current.after })
      editor.current = ed
    }
    setState(r.before === r.after ? 'same' : 'ready')
  }, [dir, tab.path, tab.commit])

  useEffect(() => {
    void load()
    return () => {
      editor.current?.dispose()
      editor.current = null
      models.current?.before.dispose()
      models.current?.after.dispose()
      models.current = null
    }
  }, [load])

  // Uncommitted changes keep changing while Claude works: follow them while the tab is on screen.
  useEffect(() => {
    if (!visible || tab.commit) return
    void load()
    const t = setInterval(() => {
      if (document.hasFocus()) void load()
    }, 3000)
    return () => clearInterval(t)
  }, [visible, tab.commit, load])

  const where = project ? relPath(tab.path, project.path) : tab.path
  const label = tab.commit ? `In commit ${tab.title.split(' @ ')[1] ?? tab.commit.slice(0, 7)}` : 'Since the last commit'

  return (
    <div className="diffview">
      <div className="file-head thread" data-color={project?.color}>
        <ProjectMark project={project} />
        {project ? <span className="chat-head-project">{project.name}</span> : null}
        <span className="chat-head-path selectable" title={tab.path}>
          {where}
        </span>
        <span className="diff-label">{label}</span>
        <span className="chat-head-spacer" />
        {!tab.commit ? (
          <button className="icon-btn" title="Check again" onClick={() => void load()}>
            <RotateCw />
          </button>
        ) : null}
        <button className="icon-btn" title="Open the file" onClick={() => useStore.getState().openFile(tab.path, tab.projectId)}>
          <FileText />
        </button>
      </div>
      <div className={`diff-host is-${state}`}>
        <div className="diff-editor" ref={host} />
        {state !== 'ready' ? (
          <div className="diff-note">
            {state === 'loading'
              ? 'Comparing'
              : state === 'same'
                ? 'No changes in this file any more.'
                : state === 'binary'
                  ? 'This is a binary file, so there is nothing to compare line by line.'
                  : error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
