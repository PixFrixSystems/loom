// What Claude is waiting on: an approval, a question or a plan. The same choices as Loom's own
// cards on the PC, laid out for a thumb.

import { CircleHelp, ClipboardList, ShieldAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PermissionRequest, PermissionResponse } from '@shared/types'
import { Diff, Markdown } from './Steps'

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

type Answer = (r: PermissionResponse) => void

function ToolAsk({ req, answer }: { req: PermissionRequest; answer: Answer }): ReactNode {
  const [reason, setReason] = useState('')
  const title = ASK_TITLES[req.toolName] ?? `Use ${req.toolName.startsWith('mcp__') ? req.toolName.split('__').slice(1).join(': ') : req.toolName}?`
  return (
    <div className="ask" role="group" aria-label={title}>
      <div className="ask-head">
        <ShieldAlert />
        <span>{title}</span>
      </div>
      {req.summary ? <div className="ask-summary">{req.summary}</div> : null}
      {req.diff ? (
        <div className="ask-scroll">
          <Diff before={req.diff.before} after={req.diff.after} />
        </div>
      ) : req.detail && req.detail !== req.summary ? (
        <pre className="ask-detail ask-scroll">{req.detail}</pre>
      ) : null}
      {req.reason ? <p className="ask-reason">{req.reason}</p> : null}
      <div className="ask-buttons">
        <button className="btn primary" onClick={() => answer({ decision: 'allow' })}>
          Allow
        </button>
        {req.canAlwaysAllow ? (
          <button className="btn" onClick={() => answer({ decision: 'allow-always' })}>
            Allow for this chat
          </button>
        ) : null}
      </div>
      <div className="ask-instead">
        <input
          className="field"
          placeholder="Or tell Claude what to do instead"
          value={reason}
          enterKeyHint="send"
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) answer({ decision: 'deny', message: reason })
          }}
        />
        <button className="btn" onClick={() => answer({ decision: 'deny', message: reason })}>
          Deny
        </button>
      </div>
    </div>
  )
}

function QuestionAsk({ req, answer }: { req: PermissionRequest; answer: Answer }): ReactNode {
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
    <div className="ask" role="group" aria-label="Claude has a question">
      <div className="ask-head">
        <CircleHelp />
        <span>{questions.length > 1 ? 'Claude has a few questions' : 'Claude has a question'}</span>
      </div>
      {questions.map((q) => (
        <fieldset key={q.question} className="question">
          <legend>{q.question}</legend>
          <div className="question-options">
            {q.options.map((o) => {
              const sel = (picked[q.question] ?? []).includes(o.label)
              return (
                <button
                  key={o.label}
                  className={`option${sel ? ' is-picked' : ''}`}
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
      <div className="ask-buttons">
        <button
          className="btn primary"
          disabled={!complete}
          onClick={() => answer({ decision: 'answer', answers: Object.fromEntries(questions.map((q) => [q.question, answerFor(q.question)])) })}
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

function PlanAsk({ req, answer }: { req: PermissionRequest; answer: Answer }): ReactNode {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="ask" role="group" aria-label="Review the plan">
      <div className="ask-head">
        <ClipboardList />
        <span>Claude finished planning. Start?</span>
      </div>
      {req.plan ? (
        <div className="ask-plan ask-scroll">
          <Markdown text={req.plan} />
        </div>
      ) : null}
      <div className="ask-buttons">
        <button className="btn primary" onClick={() => answer({ decision: 'approve-plan', mode: 'acceptEdits' })}>
          Start, edit automatically
        </button>
        <button className="btn" onClick={() => answer({ decision: 'approve-plan', mode: 'default' })}>
          Start, ask before edits
        </button>
      </div>
      <div className="ask-instead">
        <input
          className="field"
          placeholder="Or say what to change in the plan"
          value={feedback}
          enterKeyHint="send"
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

export function Ask({ req, answer }: { req: PermissionRequest; answer: Answer }): ReactNode {
  if (req.kind === 'question') return <QuestionAsk req={req} answer={answer} />
  if (req.kind === 'plan') return <PlanAsk req={req} answer={answer} />
  return <ToolAsk req={req} answer={answer} />
}
