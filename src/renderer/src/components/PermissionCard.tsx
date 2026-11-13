import { CircleHelp, ClipboardList, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PermissionRequest, PermissionResponse } from '@shared/types'
import { useStore } from '../store'
import { Markdown } from './Markdown'

const ASK_TITLES: Record<string, string> = {
  Bash: 'Run this command?',
  PowerShell: 'Run this command?',
  Write: 'Create or overwrite this file?',
  Edit: 'Make this edit?',
  MultiEdit: 'Make these edits?',
  NotebookEdit: 'Edit this notebook?',
  WebFetch: 'Fetch this page?',
  WebSearch: 'Search the web?',
  Read: 'Read this file?'
}

/** Is the person typing or working somewhere? Then a card that appears must not take the keyboard. */
function busyElsewhere(card: HTMLElement | null): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return false
  if (el.closest('input, textarea, select, [contenteditable="true"], .monaco-editor, .xterm, webview')) return true
  // Focus in another pane: leave it there.
  const panel = card?.closest('.tab-panel')
  return !!panel && !panel.contains(el)
}

/**
 * Answers a card, then puts the keyboard back in this chat's message box. Cards never focus a
 * button that answers them: a Space or Enter meant for something else must not approve a command.
 */
function useAnswer(tabId: string, requestId: string): { ref: React.RefObject<HTMLDivElement | null>; answer: (r: PermissionResponse) => void } {
  const ref = useRef<HTMLDivElement>(null)
  const respond = useStore((s) => s.respond)
  useEffect(() => {
    if (!busyElsewhere(ref.current)) ref.current?.focus({ preventScroll: true })
  }, [])
  const answer = (r: PermissionResponse): void => {
    const box = ref.current?.closest('.tab-panel')?.querySelector<HTMLTextAreaElement>('.composer-input')
    const hadFocus = !!ref.current?.contains(document.activeElement)
    respond(tabId, requestId, r)
    if (hadFocus || !busyElsewhere(ref.current)) box?.focus({ preventScroll: true })
  }
  return { ref, answer }
}

function ToolRequest({ tabId, req, external }: { tabId: string; req: PermissionRequest; external: boolean }): ReactNode {
  const [reason, setReason] = useState('')
  const { ref, answer } = useAnswer(tabId, req.requestId)
  const title = ASK_TITLES[req.toolName] ?? `Use ${req.toolName.startsWith('mcp__') ? req.toolName.split('__').slice(1).join(': ') : req.toolName}?`
  return (
    <div ref={ref} tabIndex={-1} className="ask" role="alertdialog" aria-label={title}>
      <div className="ask-head">
        <ShieldAlert />
        <span className="ask-title">{title}</span>
      </div>
      {req.summary ? <div className="ask-summary selectable">{req.summary}</div> : null}
      {req.diff ? (
        <div className="diff selectable ask-scroll">
          {req.diff.before ? <pre className="diff-del">{req.diff.before}</pre> : null}
          {req.diff.after ? <pre className="diff-add">{req.diff.after}</pre> : null}
        </div>
      ) : req.detail && req.detail !== req.summary ? (
        <pre className="tool-pre selectable ask-scroll">{req.detail}</pre>
      ) : null}
      {req.reason ? <p className="ask-reason">{req.reason}</p> : null}
      <div className="ask-actions">
        <button className="btn primary" onClick={() => answer({ decision: 'allow' })}>
          Allow
        </button>
        {req.canAlwaysAllow ? (
          <button className="btn" onClick={() => answer({ decision: 'allow-always' })} title="Don't ask again for this in this chat">
            Allow for this chat
          </button>
        ) : null}
        {!external ? (
          <input
            className="field ask-reason-input"
            placeholder="Or tell Claude what to do instead"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) answer({ decision: 'deny', message: reason })
            }}
          />
        ) : null}
        <button className="btn" onClick={() => answer({ decision: 'deny', message: reason })}>
          Deny
        </button>
      </div>
    </div>
  )
}

function QuestionRequest({ tabId, req, name }: { tabId: string; req: PermissionRequest; name: string }): ReactNode {
  const { ref, answer } = useAnswer(tabId, req.requestId)
  const questions = req.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const answerFor = (q: string): string => {
    const parts = [...(picked[q] ?? [])]
    if (other[q]?.trim()) parts.push(other[q].trim())
    return parts.join(', ')
  }
  const complete = questions.every((q) => answerFor(q.question))
  const title = `${name} has ${questions.length > 1 ? 'a few questions' : 'a question'}`

  return (
    <div ref={ref} tabIndex={-1} className="ask" role="dialog" aria-label={title}>
      <div className="ask-head">
        <CircleHelp />
        <span className="ask-title">{title}</span>
      </div>
      {questions.map((q) => (
        <fieldset key={q.question} className="question">
          <legend>
            {q.header ? <span className="question-chip">{q.header}</span> : null}
            <span className="selectable">{q.question}</span>
          </legend>
          <div className="question-options">
            {q.options.map((o) => {
              const sel = (picked[q.question] ?? []).includes(o.label)
              return (
                <button
                  key={o.label}
                  className={`option${sel ? ' selected' : ''}`}
                  aria-pressed={sel}
                  onClick={() =>
                    setPicked((p) => {
                      const cur = p[q.question] ?? []
                      const next = q.multiSelect ? (sel ? cur.filter((x) => x !== o.label) : [...cur, o.label]) : sel ? [] : [o.label]
                      return { ...p, [q.question]: next }
                    })
                  }
                >
                  <span className="option-label">{o.label}</span>
                  {o.description ? <span className="option-desc">{o.description}</span> : null}
                </button>
              )
            })}
          </div>
          <input
            className="field"
            placeholder="Other answer (optional)"
            value={other[q.question] ?? ''}
            onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
          />
        </fieldset>
      ))}
      <div className="ask-actions">
        <button
          className="btn primary"
          disabled={!complete}
          onClick={() =>
            answer({
              decision: 'answer',
              answers: Object.fromEntries(questions.map((q) => [q.question, answerFor(q.question)]))
            })
          }
        >
          Send answers
        </button>
        <button className="btn ghost" onClick={() => answer({ decision: 'deny', message: 'The user skipped the question.' })}>
          Skip
        </button>
      </div>
    </div>
  )
}

function PlanRequest({ tabId, req, cwd }: { tabId: string; req: PermissionRequest; cwd: string }): ReactNode {
  const { ref, answer } = useAnswer(tabId, req.requestId)
  const [feedback, setFeedback] = useState('')
  return (
    <div ref={ref} tabIndex={-1} className="ask" role="dialog" aria-label="Review the plan">
      <div className="ask-head">
        <ClipboardList />
        <span className="ask-title">Claude finished planning. Start?</span>
      </div>
      {req.plan ? (
        <div className="plan ask-scroll">
          <Markdown text={req.plan} cwd={cwd} />
        </div>
      ) : null}
      <div className="ask-actions">
        <button className="btn primary" onClick={() => answer({ decision: 'approve-plan', mode: 'acceptEdits' })}>
          Start, edit automatically
        </button>
        <button className="btn" onClick={() => answer({ decision: 'approve-plan', mode: 'default' })}>
          Start, ask before edits
        </button>
        <input
          className="field ask-reason-input"
          placeholder="Or say what to change in the plan"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) answer({ decision: 'reject-plan', message: feedback })
          }}
        />
        <button className="btn" onClick={() => answer({ decision: 'reject-plan', message: feedback })}>
          Keep planning
        </button>
      </div>
    </div>
  )
}

export function PermissionCard({ tabId, req, cwd, external, name }: { tabId: string; req: PermissionRequest; cwd: string; external: boolean; name: string }): ReactNode {
  if (req.kind === 'question') return <QuestionRequest tabId={tabId} req={req} name={name} />
  if (req.kind === 'plan') return <PlanRequest tabId={tabId} req={req} cwd={cwd} />
  return <ToolRequest tabId={tabId} req={req} external={external} />
}
