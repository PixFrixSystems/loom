import { CircleHelp, ClipboardList, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PermissionRequest } from '@shared/types'
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

function ToolRequest({ tabId, req }: { tabId: string; req: PermissionRequest }): ReactNode {
  const [reason, setReason] = useState('')
  const allowRef = useRef<HTMLButtonElement>(null)
  const respond = useStore((s) => s.respond)
  useEffect(() => {
    allowRef.current?.focus({ preventScroll: true })
  }, [])
  const title = ASK_TITLES[req.toolName] ?? `Use ${req.toolName.startsWith('mcp__') ? req.toolName.split('__').slice(1).join(': ') : req.toolName}?`
  return (
    <div className="ask" role="alertdialog" aria-label={title}>
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
        <button ref={allowRef} className="btn primary" onClick={() => respond(tabId, req.requestId, { decision: 'allow' })}>
          Allow
        </button>
        {req.canAlwaysAllow ? (
          <button className="btn" onClick={() => respond(tabId, req.requestId, { decision: 'allow-always' })} title="Don't ask again for this in this chat">
            Allow for this chat
          </button>
        ) : null}
        <input
          className="field ask-reason-input"
          placeholder="Or tell Claude what to do instead"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') respond(tabId, req.requestId, { decision: 'deny', message: reason })
          }}
        />
        <button className="btn" onClick={() => respond(tabId, req.requestId, { decision: 'deny', message: reason })}>
          Deny
        </button>
      </div>
    </div>
  )
}

function QuestionRequest({ tabId, req }: { tabId: string; req: PermissionRequest }): ReactNode {
  const respond = useStore((s) => s.respond)
  const questions = req.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const answerFor = (q: string): string => {
    const parts = [...(picked[q] ?? [])]
    if (other[q]?.trim()) parts.push(other[q].trim())
    return parts.join(', ')
  }
  const complete = questions.every((q) => answerFor(q.question))

  return (
    <div className="ask" role="dialog" aria-label="Claude has a question">
      <div className="ask-head">
        <CircleHelp />
        <span className="ask-title">{questions.length > 1 ? 'Claude has a few questions' : 'Claude has a question'}</span>
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
            respond(tabId, req.requestId, {
              decision: 'answer',
              answers: Object.fromEntries(questions.map((q) => [q.question, answerFor(q.question)]))
            })
          }
        >
          Send answers
        </button>
        <button className="btn ghost" onClick={() => respond(tabId, req.requestId, { decision: 'deny', message: 'The user skipped the question.' })}>
          Skip
        </button>
      </div>
    </div>
  )
}

function PlanRequest({ tabId, req, cwd }: { tabId: string; req: PermissionRequest; cwd: string }): ReactNode {
  const respond = useStore((s) => s.respond)
  const [feedback, setFeedback] = useState('')
  return (
    <div className="ask" role="dialog" aria-label="Review the plan">
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
        <button className="btn primary" onClick={() => respond(tabId, req.requestId, { decision: 'approve-plan', mode: 'acceptEdits' })}>
          Start, edit automatically
        </button>
        <button className="btn" onClick={() => respond(tabId, req.requestId, { decision: 'approve-plan', mode: 'default' })}>
          Start, ask before edits
        </button>
        <input
          className="field ask-reason-input"
          placeholder="Or say what to change in the plan"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') respond(tabId, req.requestId, { decision: 'reject-plan', message: feedback })
          }}
        />
        <button className="btn" onClick={() => respond(tabId, req.requestId, { decision: 'reject-plan', message: feedback })}>
          Keep planning
        </button>
      </div>
    </div>
  )
}

export function PermissionCard({ tabId, req, cwd }: { tabId: string; req: PermissionRequest; cwd: string }): ReactNode {
  if (req.kind === 'question') return <QuestionRequest tabId={tabId} req={req} />
  if (req.kind === 'plan') return <PlanRequest tabId={tabId} req={req} cwd={cwd} />
  return <ToolRequest tabId={tabId} req={req} />
}
