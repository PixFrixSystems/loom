import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

/**
 * The one question Loom asks before something can't be undone: unsaved edits, a working chat,
 * removing a project. Esc and a click outside pick the cancel choice; focus starts on the safe one.
 */
export function ConfirmHost(): ReactNode {
  const c = useStore((s) => s.confirm)
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!c) return
    const before = document.activeElement as HTMLElement | null
    if (c.input && field.current) {
      field.current.focus()
      const [a, b] = c.input.select ?? [0, c.input.value.length]
      field.current.setSelectionRange(a, b)
    } else box.current?.querySelector<HTMLButtonElement>(`[data-choice="${c.focus ?? c.cancel}"]`)?.focus()
    return () => before?.focus?.({ preventScroll: true })
  }, [c])

  if (!c) return null
  const pick = (id: string): void => {
    const text = field.current?.value
    useStore.setState({ confirm: null })
    c.resolve(id, text)
  }
  const shown = c.items?.slice(0, 6) ?? []
  const more = (c.items?.length ?? 0) - shown.length

  return createPortal(
    <div className="confirm-backdrop" onMouseDown={() => pick(c.cancel)}>
      <div
        ref={box}
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={c.body ? 'confirm-body' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            pick(c.cancel)
          } else if (e.key === 'Tab') {
            // Keep the keyboard inside the question.
            const buttons = [...(box.current?.querySelectorAll<HTMLElement>('input, button') ?? [])]
            const i = buttons.indexOf(document.activeElement as HTMLElement)
            const next = buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]
            if (next) {
              e.preventDefault()
              next.focus()
            }
          }
        }}
      >
        <h2 id="confirm-title" className="confirm-title">
          {c.title}
        </h2>
        {c.body ? (
          <p id="confirm-body" className="confirm-body">
            {c.body}
          </p>
        ) : null}
        {c.input ? (
          <input
            ref={field}
            className="field confirm-input"
            defaultValue={c.input.value}
            placeholder={c.input.placeholder}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                pick(c.choices[0].id)
              }
            }}
          />
        ) : null}
        {shown.length ? (
          <ul className="confirm-items">
            {shown.map((item, i) => (
              <li key={i} className="selectable">
                {item}
              </li>
            ))}
            {more > 0 ? <li className="confirm-more">and {more} more</li> : null}
          </ul>
        ) : null}
        <div className="confirm-actions">
          {c.choices.map((ch) => (
            <button key={ch.id} data-choice={ch.id} className={`btn${ch.kind ? ` ${ch.kind}` : ''}`} onClick={() => pick(ch.id)}>
              {ch.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Short notes about something that didn't work, at the bottom right, gone after a few seconds. */
export function ToastHost(): ReactNode {
  const toasts = useStore((s) => s.toasts)
  if (!toasts.length) return null
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="selectable">{t.text}</span>
          <button className="icon-btn small toast-close" aria-label="Dismiss" onClick={() => useStore.getState().dismissToast(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
