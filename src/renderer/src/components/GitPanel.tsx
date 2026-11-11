import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitBranch, LoaderCircle, Minus, PenLine, Plus, RotateCw, Undo2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { GitCommit, GitCommitFile, GitFile, GitResult, Project } from '@shared/types'
import { relPath, timeAgo } from '../lib/paths'
import { useStore } from '../store'

const LETTER_NAMES: Record<string, string> = {
  M: 'Changed',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'New file, not tracked yet',
  T: 'Type changed',
  '!': 'Conflict: both sides changed it'
}

/** The commit message you were writing, per project, kept while you look elsewhere. */
const drafts = new Map<string, string>()

type Side = 'staged' | 'changes'
type Busy = null | 'commit' | 'push' | 'pull' | 'write' | 'switch' | 'files'
type Note = { tone: 'ok' | 'err'; text: string; detail?: string }

const keyOf = (side: Side, f: GitFile): string => `${side}:${f.path}`

function letterOf(f: GitFile, side: Side): string {
  if (f.conflicted) return '!'
  if (f.untracked) return 'U'
  return side === 'staged' ? f.index : f.work
}

function FileRow({
  f,
  side,
  project,
  selected,
  confirming,
  onClick,
  onOpen,
  onStage,
  onUnstage,
  onAskDiscard
}: {
  f: GitFile
  side: Side
  project: Project
  selected: boolean
  confirming: boolean
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void
  onOpen: () => void
  onStage: () => void
  onUnstage: () => void
  onAskDiscard: () => void
}): ReactNode {
  const letter = letterOf(f, side)
  const name = f.path.split('/').pop() ?? f.path
  const where = relPath(f.abs, project.path).split(/[\\/]/).slice(0, -1).join('/')
  return (
    <div
      className={`git-row${selected ? ' selected' : ''}${confirming ? ' confirming' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={`${LETTER_NAMES[letter] ?? letter}: ${f.path}${f.from ? ` (was ${f.from})` : ''}\nDouble-click to see the changes. Ctrl+click or Shift+click to select more`}
      // Shift+click selects a range and a double-click opens; neither should select the row's text.
      onMouseDown={(e) => (e.shiftKey || e.detail > 1) && e.preventDefault()}
      onClick={onClick}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen()
        } else if (e.key === ' ') {
          e.preventDefault()
          onClick(e)
        }
      }}
    >
      <span className={`git-letter s-${letter === '!' ? 'x' : letter}`}>{letter}</span>
      <span className={`tree-name${letter === 'D' ? ' is-deleted' : ''}`}>{name}</span>
      <span className="tree-dir">{where}</span>
      <span className="git-actions" onClick={(e) => e.stopPropagation()}>
        {side === 'changes' ? (
          <>
            <button className="icon-btn small" title="Throw away these changes" aria-label={`Throw away changes to ${name}`} onClick={onAskDiscard}>
              <Undo2 />
            </button>
            <button className="icon-btn small" title="Stage" aria-label={`Stage ${name}`} onClick={onStage}>
              <Plus />
            </button>
          </>
        ) : (
          <button className="icon-btn small" title="Unstage" aria-label={`Unstage ${name}`} onClick={onUnstage}>
            <Minus />
          </button>
        )}
      </span>
    </div>
  )
}

/** Uncommitted work in a project, the commit box, branches and recent history. */
export function GitPanel({ project }: { project: Project }): ReactNode {
  const changes = useStore((s) => s.gitChanges[project.id])
  const [message, setMessage] = useState(() => drafts.get(project.id) ?? '')
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [newBranch, setNewBranch] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [log, setLog] = useState<GitCommit[] | null>(null)
  const [openCommit, setOpenCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  // Files picked with Ctrl+click and Shift+click, and where a Shift+click range starts.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<{ side: Side; index: number } | null>(null)
  const dir = project.path
  const s = useStore.getState()
  const refresh = (): void => void useStore.getState().refreshChanges(project.id)

  useEffect(() => {
    refresh()
    const t = setInterval(() => {
      if (document.hasFocus()) refresh()
    }, 4000)
    return () => clearInterval(t)
  }, [project.id])

  useEffect(() => {
    if (historyOpen) void window.loom.gitLog(dir).then(setLog)
  }, [historyOpen, changes?.ahead, changes?.branch])

  const setDraft = (v: string): void => {
    setMessage(v)
    drafts.set(project.id, v)
  }

  const run = async (kind: Busy, fn: () => Promise<GitResult>, done?: string): Promise<GitResult> => {
    setBusy(kind)
    setNote(null)
    setShowDetail(false)
    const r = await fn().catch((e: Error) => ({ ok: false, output: e.message }) as GitResult)
    setBusy(null)
    refresh()
    if (!r.ok) setNote({ tone: 'err', text: r.output.split('\n').find((l) => l.trim()) ?? 'That did not work.', detail: r.output })
    else if (done) setNote({ tone: 'ok', text: done, detail: r.output || undefined })
    return r
  }

  if (changes === undefined) {
    return (
      <div className="git-panel">
        <p className="pane-note pad">
          <LoaderCircle className="spin" /> Looking at the repository
        </p>
      </div>
    )
  }
  if (changes === null) {
    return (
      <div className="git-panel">
        <p className="pane-note pad">This folder is not a git repository. Ask Claude in a chat to set one up, or to connect it to GitHub.</p>
      </div>
    )
  }

  const staged = changes.files.filter((f) => f.staged)
  const unstaged = changes.files.filter((f) => f.unstaged)
  const nothing = changes.files.length === 0
  const stageAll = staged.length === 0

  // The selection as files still there: a refresh may have committed or dropped some.
  const pickedStaged = staged.filter((f) => picked.has(keyOf('staged', f)))
  const pickedChanges = unstaged.filter((f) => picked.has(keyOf('changes', f)))
  const pickedFiles = [...new Map([...pickedStaged, ...pickedChanges].map((f) => [f.path, f])).values()]
  // A renamed file's old name goes along, or its removal would stay behind uncommitted.
  const pickedPaths = pickedFiles.flatMap((f) => (f.from ? [f.abs, `${changes.root}\\${f.from.replace(/\//g, '\\')}`] : [f.abs]))
  const canCommit = !!message.trim() && !nothing && !busy

  const clearPicked = (): void => {
    setPicked(new Set())
    setConfirm((c) => (c === 'picked' ? null : c))
  }

  const rowClick = (e: React.MouseEvent | React.KeyboardEvent, side: Side, list: GitFile[], index: number): void => {
    const f = list[index]
    if (e.shiftKey && anchor?.side === side) {
      const [from, to] = anchor.index < index ? [anchor.index, index] : [index, anchor.index]
      const next = new Set(e.ctrlKey || e.metaKey ? picked : [])
      for (let i = from; i <= to; i++) next.add(keyOf(side, list[i]))
      setPicked(next)
    } else if (e.ctrlKey || e.metaKey || e.type === 'keydown') {
      const next = new Set(picked)
      const k = keyOf(side, f)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      setPicked(next)
      setAnchor({ side, index })
    } else {
      // A click selects just this file; a double-click opens it.
      setPicked(new Set([keyOf(side, f)]))
      setConfirm((c) => (c === 'picked' ? null : c))
      setAnchor({ side, index })
    }
  }

  const openRow = (f: GitFile): void => useStore.getState().openDiff(project.id, f.abs)

  const commit = async (): Promise<void> => {
    if (!canCommit) return
    const only = pickedFiles.length ? pickedPaths : []
    const count = pickedFiles.length || (stageAll ? unstaged.length : staged.length)
    const r = await run('commit', () => window.loom.gitCommit(dir, message.trim(), stageAll && !only.length, only), `Committed ${count === 1 ? '1 file' : `${count} files`}.`)
    if (r.ok) {
      setDraft('')
      clearPicked()
    }
  }

  const discard = async (files: GitFile[]): Promise<void> => {
    setConfirm(null)
    const r = await run('files', () =>
      window.loom.gitDiscard(
        dir,
        files.map((f) => ({ abs: f.abs, untracked: f.untracked, added: f.index === 'A' }))
      )
    )
    if (r.ok) {
      clearPicked()
      setNote({ tone: 'ok', text: 'Thrown away. A copy of each file is kept in case you need it.', detail: r.backup })
    }
  }

  const branchMenu = async (e: React.MouseEvent): Promise<void> => {
    const at = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { current, branches } = await window.loom.gitBranches(dir)
    s.showMenu({ clientX: at.left, clientY: at.bottom + 4 }, [
      ...branches.map((b) => ({
        label: b,
        checked: b === current,
        onSelect: () => {
          if (b !== current) void run('switch', () => window.loom.gitSwitch(dir, b, false), `Switched to ${b}.`)
        }
      })),
      { separator: true, label: '' },
      { label: 'New branch…', onSelect: () => setNewBranch('') }
    ])
  }

  const toggleCommit = async (hash: string): Promise<void> => {
    if (openCommit === hash) return setOpenCommit(null)
    setOpenCommit(hash)
    setCommitFiles([])
    setCommitFiles(await window.loom.gitCommitFiles(dir, hash))
  }

  const confirmStrip = (key: string, files: GitFile[], what: string): ReactNode =>
    confirm === key ? (
      <div className="git-confirm" role="alertdialog" aria-label="Throw away changes">
        <span>Throw away {what}? A copy is kept.</span>
        <span className="git-confirm-actions">
          <button className="btn danger-btn" onClick={() => void discard(files)}>
            Throw away
          </button>
          <button className="btn ghost" onClick={() => setConfirm(null)}>
            Keep
          </button>
        </span>
      </div>
    ) : null

  const commitLabel = pickedFiles.length ? `Commit ${pickedFiles.length} selected` : stageAll ? 'Commit all' : 'Commit'
  const commitTitle = pickedFiles.length
    ? 'Commits only the selected files. Anything else you staged stays staged'
    : stageAll
      ? 'Nothing is staged, so this stages every change first'
      : 'Commit the staged files'

  return (
    <div
      className="git-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && picked.size) {
          e.stopPropagation()
          clearPicked()
        }
      }}
    >
      <div className="git-head">
        <button className="git-branch" title="Switch branch, or start a new one" onClick={(e) => void branchMenu(e)} disabled={!!busy}>
          <GitBranch />
          <span className="git-branch-name">{changes.branch ?? 'no branch'}</span>
          <ChevronDown className="git-branch-caret" />
        </button>
        <span className="git-head-actions">
          <button
            className="git-sync"
            title={changes.behind ? `Pull ${changes.behind} new commit${changes.behind === 1 ? '' : 's'}` : 'Pull: get new commits from GitHub'}
            disabled={!!busy || !changes.upstream}
            onClick={() => void run('pull', () => window.loom.gitPull(dir), 'Up to date with the remote.')}
          >
            {busy === 'pull' ? <LoaderCircle className="spin" /> : <ArrowDown />}
            {changes.behind ? changes.behind : null}
          </button>
          <button
            className={`git-sync${changes.ahead || !changes.upstream ? ' is-due' : ''}`}
            title={changes.upstream ? (changes.ahead ? `Push ${changes.ahead} commit${changes.ahead === 1 ? '' : 's'}` : 'Push: nothing waiting') : 'Publish this branch to GitHub'}
            disabled={!!busy || (!!changes.upstream && !changes.ahead)}
            onClick={() => void run('push', () => window.loom.gitPush(dir), changes.upstream ? 'Pushed.' : 'Published.')}
          >
            {busy === 'push' ? <LoaderCircle className="spin" /> : <ArrowUp />}
            {changes.ahead ? changes.ahead : null}
          </button>
          <button className="icon-btn small" title="Check again" onClick={refresh}>
            <RotateCw />
          </button>
        </span>
      </div>

      {newBranch !== null ? (
        <form
          className="git-newbranch"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newBranch.trim().replace(/\s+/g, '-')
            if (!name) return
            setNewBranch(null)
            void run('switch', () => window.loom.gitSwitch(dir, name, true), `Started ${name}. Your changes came along.`)
          }}
        >
          <input
            className="git-input"
            autoFocus
            placeholder="New branch name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewBranch(null)}
          />
          <button className="btn" type="submit" disabled={!newBranch.trim()}>
            Create
          </button>
        </form>
      ) : null}

      <div className="git-commit">
        <textarea
          className="git-input git-message selectable"
          rows={3}
          placeholder={nothing ? 'Nothing to commit' : 'Commit message (Ctrl+Enter to commit)'}
          value={message}
          disabled={nothing && !message}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <div className="git-commit-actions">
          <button
            className="btn ghost"
            disabled={nothing || !!busy}
            title={
              pickedFiles.length
                ? 'Claude reads the selected files and writes the message, following your commit rules'
                : 'Claude reads the changes and writes the message, following your commit rules'
            }
            onClick={async () => {
              setBusy('write')
              setNote(null)
              const r = await window.loom.gitWriteMessage(dir, pickedFiles.length ? pickedPaths : undefined)
              setBusy(null)
              if (r.message) setDraft(r.message)
              else setNote({ tone: 'err', text: r.error ?? 'Claude did not write a message.' })
            }}
          >
            {busy === 'write' ? <LoaderCircle className="spin" /> : <PenLine />}
            {busy === 'write' ? 'Writing' : 'Write with Claude'}
          </button>
          <button className="btn primary" disabled={!canCommit} title={commitTitle} onClick={() => void commit()}>
            {busy === 'commit' ? <LoaderCircle className="spin" /> : null}
            {commitLabel}
          </button>
        </div>
      </div>

      {note ? (
        <div className={`git-note tone-${note.tone}`} role="status">
          <span>{note.text}</span>
          {note.detail && note.detail !== note.text ? (
            <button className="note-toggle" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? 'Hide' : 'Details'}
            </button>
          ) : null}
          {showDetail && note.detail ? <pre className="note-detail selectable">{note.detail}</pre> : null}
        </div>
      ) : null}


      <div
        className="git-lists"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Changed files"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('git-section')) clearPicked()
        }}
      >
        {nothing ? <p className="pane-note pad">Nothing to commit. Changes you or Claude make in this folder show up here.</p> : null}

        {staged.length ? (
          <section className="git-section">
            <div className="git-section-head">
              <span>Staged</span>
              <span className="git-count">{staged.length}</span>
              <span className="git-section-actions">
                <button className="icon-btn small" title="Unstage all" onClick={() => void run('files', () => window.loom.gitUnstage(dir, staged.map((f) => f.abs)))}>
                  <Minus />
                </button>
              </span>
            </div>
            {staged.map((f, i) => (
              <FileRow
                key={`s:${f.path}`}
                f={f}
                side="staged"
                project={project}
                selected={picked.has(keyOf('staged', f))}
                confirming={false}
                onClick={(e) => rowClick(e, 'staged', staged, i)}
                onOpen={() => openRow(f)}
                onStage={() => undefined}
                onUnstage={() => void run('files', () => window.loom.gitUnstage(dir, [f.abs]))}
                onAskDiscard={() => undefined}
              />
            ))}
          </section>
        ) : null}

        {unstaged.length ? (
          <section className="git-section">
            <div className="git-section-head">
              <span>Changes</span>
              <span className="git-count">{unstaged.length}</span>
              <span className="git-section-actions">
                <button className="icon-btn small" title="Throw away all changes" onClick={() => setConfirm('*')}>
                  <Undo2 />
                </button>
                <button className="icon-btn small" title="Stage all" onClick={() => void run('files', () => window.loom.gitStage(dir, unstaged.map((f) => f.abs)))}>
                  <Plus />
                </button>
              </span>
            </div>
            {confirmStrip('*', unstaged, `all ${unstaged.length} changes`)}
            {unstaged.map((f, i) => (
              <div key={`u:${f.path}`}>
                <FileRow
                  f={f}
                  side="changes"
                  project={project}
                  selected={picked.has(keyOf('changes', f))}
                  confirming={confirm === f.abs}
                  onClick={(e) => rowClick(e, 'changes', unstaged, i)}
                  onOpen={() => openRow(f)}
                  onStage={() => void run('files', () => window.loom.gitStage(dir, [f.abs]))}
                  onUnstage={() => undefined}
                  onAskDiscard={() => setConfirm(f.abs)}
                />
                {confirmStrip(f.abs, [f], `your changes to ${f.path.split('/').pop()}`)}
              </div>
            ))}
          </section>
        ) : null}

        <section className="git-section">
          <button className="git-section-head git-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
            <ChevronRight className={`tree-chev${historyOpen ? ' open' : ''}`} />
            <span>History</span>
          </button>
          {historyOpen ? (
            log === null ? (
              <p className="pane-note pad">
                <LoaderCircle className="spin" /> Reading history
              </p>
            ) : log.length === 0 ? (
              <p className="pane-note pad">No commits yet.</p>
            ) : (
              log.map((c) => (
                <div key={c.hash}>
                  <button className={`git-commit-row${openCommit === c.hash ? ' open' : ''}`} title={`${c.subject}\n${c.short} by ${c.author}`} onClick={() => void toggleCommit(c.hash)}>
                    <span className="git-commit-subject">{c.subject}</span>
                    <span className="git-commit-when">{timeAgo(c.at)}</span>
                  </button>
                  {openCommit === c.hash ? (
                    <div className="git-commit-files">
                      {commitFiles.length === 0 ? (
                        <p className="pane-note">No files in this folder changed.</p>
                      ) : (
                        commitFiles.map((f) => (
                          <button key={f.path} className="git-row" title={f.path} onClick={() => s.openDiff(project.id, f.abs, c.hash, c.short)}>
                            <span className={`git-letter s-${f.status}`}>{f.status}</span>
                            <span className="tree-name">{f.path.split('/').pop()}</span>
                            <span className="tree-dir">{relPath(f.abs, project.path).split(/[\\/]/).slice(0, -1).join('/')}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              ))
            )
          ) : null}
        </section>
      </div>

      {pickedFiles.length ? (
        <div className="git-picked" role="toolbar" aria-label="Selected files">
          <span className="git-picked-count">{pickedFiles.length === 1 ? '1 file selected' : `${pickedFiles.length} files selected`}</span>
          {pickedChanges.length ? (
            <>
              <button className="icon-btn small" title="Throw away the selected changes" onClick={() => setConfirm('picked')}>
                <Undo2 />
              </button>
              <button
                className="icon-btn small"
                title="Stage the selected files"
                onClick={() => void run('files', () => window.loom.gitStage(dir, pickedChanges.map((f) => f.abs))).then(clearPicked)}
              >
                <Plus />
              </button>
            </>
          ) : null}
          {pickedStaged.length ? (
            <button
              className="icon-btn small"
              title="Unstage the selected files"
              onClick={() => void run('files', () => window.loom.gitUnstage(dir, pickedStaged.map((f) => f.abs))).then(clearPicked)}
            >
              <Minus />
            </button>
          ) : null}
          <button className="icon-btn small" title="Clear the selection (Esc)" onClick={clearPicked}>
            <X />
          </button>
        </div>
      ) : null}
      {confirmStrip('picked', pickedChanges, pickedChanges.length === 1 ? 'the selected change' : `${pickedChanges.length} selected changes`)}
    </div>
  )
}
