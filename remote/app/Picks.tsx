// A chat's model and effort, picked on the phone: the same choices as the pickers in Loom's
// message box, in a sheet that comes up from the bottom of the screen.

import { Check, Cpu, Gauge } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EffortLevel } from '@shared/types'
import { useApp } from './state'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

interface Choice {
  value: string
  label: string
  description?: string
}

/** A list of choices that comes up from the bottom of the screen: the phone's kind of dropdown. */
function Sheet({
  title,
  hint,
  value,
  choices,
  onPick,
  onClose
}: {
  title: string
  hint?: string
  value: string
  choices: Choice[]
  onPick: (value: string) => void
  onClose: () => void
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    // Focus goes to the sheet itself, not to its first button, which would show a ring nobody asked for.
    body.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])
  return (
    // Esc, the phone's back gesture and a tap outside all close it.
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={body} className="sheet-body" tabIndex={-1}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {hint ? <p className="sheet-hint">{hint}</p> : null}
        <div className="sheet-list" role="radiogroup" aria-label={title}>
          {choices.map((c) => {
            const picked = c.value === value
            return (
              <button
                key={c.value}
                role="radio"
                aria-checked={picked}
                className={`option${picked ? ' is-picked' : ''}`}
                onClick={() => {
                  if (!picked) onPick(c.value)
                  onClose()
                }}
              >
                <span className="option-label">
                  {c.label}
                  {picked ? <Check /> : null}
                </span>
                {c.description ? <span className="option-desc">{c.description}</span> : null}
              </button>
            )
          })}
        </div>
      </div>
    </dialog>
  )
}

export function Picks({ tabId, off }: { tabId: string; off: boolean }): ReactNode {
  const state = useApp((s) => s.chats[tabId]?.state)
  const listModels = useApp((s) => s.list?.models)
  const setModel = useApp((s) => s.setModel)
  const setEffort = useApp((s) => s.setEffort)
  const [open, setOpen] = useState<'model' | 'effort' | null>(null)
  const models = state?.models ?? listModels
  if (!state || (state.provider === 'external' && !models?.length)) return null
  const modelLabel = models?.find((m) => m.value === state.modelValue)?.label ?? (state.modelValue || 'Default')
  const usual = state.defaultEffort
  const effortLabel = state.effort ? EFFORT_LABELS[state.effort] : usual ? EFFORT_LABELS[usual] : 'Default'
  return (
    <div className="picks">
      <button type="button" className="pick" disabled={off || !models?.length} aria-haspopup="dialog" title={`Model: ${modelLabel}`} onClick={() => setOpen('model')}>
        <Cpu />
        <span>{modelLabel}</span>
      </button>
      {state.efforts.length ? (
        <button type="button" className="pick" disabled={off} aria-haspopup="dialog" title={`Effort: ${effortLabel}`} onClick={() => setOpen('effort')}>
          <Gauge />
          <span>{effortLabel}</span>
        </button>
      ) : null}
      {open === 'model' && models ? (
        <Sheet title="Model" value={state.modelValue} choices={models} onPick={(v) => setModel(tabId, v)} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'effort' ? (
        <Sheet
          title="Effort"
          hint="How hard the agent thinks before answering."
          value={state.effort ?? ''}
          choices={[
            { value: '', label: usual ? `Default (${EFFORT_LABELS[usual]})` : 'Default', description: 'What your agent settings use' },
            ...state.efforts.map((e) => ({ value: e as string, label: EFFORT_LABELS[e] }))
          ]}
          onPick={(v) => setEffort(tabId, (v || null) as EffortLevel | null)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  )
}
