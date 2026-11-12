import { LoaderCircle, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
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
            <LoaderCircle className="spin agent-spin" aria-hidden="true" />
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
