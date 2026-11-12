import { Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTask } from '@shared/types'

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/**
 * The sub-agents and background tasks Claude has running in this chat: what each is doing, how
 * long it has run, and a way to stop one. They can keep going after Claude's reply has ended.
 */
export function AgentTasks({ tabId, tasks }: { tabId: string; tasks: AgentTask[] }): ReactNode {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="agents" role="status" aria-label="Agents running">
      <div className="agents-head">{tasks.length === 1 ? '1 agent working' : `${tasks.length} agents working`}</div>
      {tasks.map((t) => {
        const meta = [t.agentType && t.agentType !== t.description ? t.agentType : '', t.lastTool ?? '', t.toolUses ? `${t.toolUses} ${t.toolUses === 1 ? 'tool use' : 'tool uses'}` : '', elapsed(Date.now() - t.startedAt)].filter(Boolean)
        return (
          <div key={t.id} className="agent-row">
            {/* A lit violet LED rather than a spinner: only the thinking dot may loop. */}
            <span className="agent-led" aria-hidden="true" />
            <div className="agent-text">
              <span className="agent-desc selectable" title={t.description}>
                {t.description}
              </span>
              {t.summary ? <span className="agent-summary selectable">{t.summary}</span> : null}
            </div>
            <span className="agent-meta">{meta.join(', ')}</span>
            <button className="icon-btn small" title="Stop this agent" aria-label={`Stop ${t.description}`} onClick={() => void window.loom.chatStopTask(tabId, t.id)}>
              <Square />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The chat header's Agents button: while sub-agents work, a violet light and how many; a click
 * lists each one with how long it has worked and its latest steps.
 */
export function AgentsButton({ tabId, tasks }: { tabId: string; tasks: AgentTask[] }): ReactNode {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!tasks.length) setAnchor(null)
  }, [tasks.length])
  if (!tasks.length) return null
  const label = tasks.length === 1 ? '1 agent' : `${tasks.length} agents`
  return (
    <>
      <button
        ref={btn}
        className={`agents-btn${anchor ? ' open' : ''}`}
        title="See what the agents are doing"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={() => setAnchor(anchor ? null : (btn.current?.getBoundingClientRect() ?? null))}
      >
        <span className="live-dot" aria-hidden="true" />
        <span className="agents-btn-label">{label}</span>
      </button>
      {anchor ? <AgentsPopover anchor={anchor} tabId={tabId} tasks={tasks} onClose={() => setAnchor(null)} /> : null}
    </>
  )
}

function AgentsPopover({ anchor, tabId, tasks, onClose }: { anchor: DOMRect; tabId: string; tasks: AgentTask[]; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    const onDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement
      if (!ref.current?.contains(el) && !el.closest('.agents-btn')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const right = Math.max(8, window.innerWidth - anchor.right)
  return createPortal(
    <div ref={ref} className="menu agents-pop" role="dialog" aria-label="Agents working" style={{ right, top: anchor.bottom + 6 }}>
      <div className="agents-pop-head">{tasks.length === 1 ? '1 agent working' : `${tasks.length} agents working`}</div>
      {tasks.map((t) => {
        const meta = [
          t.agentType && t.agentType !== t.description ? t.agentType : '',
          `working for ${elapsed(Date.now() - t.startedAt)}`,
          t.toolUses ? `${t.toolUses} ${t.toolUses === 1 ? 'tool use' : 'tool uses'}` : ''
        ].filter(Boolean)
        const steps = t.steps ?? []
        return (
          <div key={t.id} className="agents-pop-item">
            <div className="agents-pop-top">
              <span className="agent-led" aria-hidden="true" />
              <span className="agents-pop-desc selectable" title={t.description}>
                {t.description}
              </span>
              <button className="icon-btn small" title="Stop this agent" aria-label={`Stop ${t.description}`} onClick={() => void window.loom.chatStopTask(tabId, t.id)}>
                <Square />
              </button>
            </div>
            <div className="agents-pop-meta">{meta.join(', ')}</div>
            {t.summary ? <p className="agents-pop-summary selectable">{t.summary}</p> : null}
            {steps.length ? (
              <ul className="agents-pop-steps" aria-label="Latest steps">
                {steps.map((step, i) => (
                  <li key={`${step.at}-${i}`} className={i === steps.length - 1 ? 'now' : undefined} title={step.text}>
                    {step.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="agents-pop-empty">{t.lastTool ? `Using ${t.lastTool}` : 'Getting started'}</p>
            )}
          </div>
        )
      })}
    </div>,
    document.body
  )
}
