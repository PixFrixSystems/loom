import { ArrowRightLeft, CircleCheck, Cpu, FolderTree, Gauge, Image, PanelTop, SendToBack } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { HighlightIcon } from '../whatsNew'
import { CloudMark } from './Servers'

function Icon({ name }: { name: HighlightIcon }): ReactNode {
  switch (name) {
    case 'cloud':
      return <CloudMark />
    case 'model':
      return <Cpu />
    case 'done':
      return <CircleCheck />
    case 'switch':
      return <ArrowRightLeft />
    case 'background':
      return <SendToBack />
    case 'pin':
      return <PanelTop />
    case 'usage':
      return <Gauge />
    case 'files':
      return <FolderTree />
    case 'media':
      return <Image />
  }
}

/**
 * Shown once after Loom updates: the few changes in the new version worth knowing about, each with
 * where to find it. All changes are a click away on GitHub.
 */
export function WhatsNew(): ReactNode {
  const notes = useStore((s) => s.whatsNew)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!notes) return
    const before = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLButtonElement>('[data-choice="ok"]')?.focus()
    return () => before?.focus?.({ preventScroll: true })
  }, [notes])
  if (!notes?.length) return null
  const close = (): void => useStore.setState({ whatsNew: null })
  const newest = notes[0].version
  return createPortal(
    <div className="confirm-backdrop" onMouseDown={close}>
      <div
        ref={box}
        className="confirm whats-new"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
      >
        <h2 id="whats-new-title" className="confirm-title">
          What&apos;s new in Loom {newest}
        </h2>
        {notes.map((r) => (
          <section key={r.version} className="whats-new-release">
            {notes.length > 1 ? <h3 className="whats-new-version">In {r.version}</h3> : null}
            <ul className="whats-new-list">
              {r.highlights.map((h) => (
                <li key={h.title} className="whats-new-item">
                  <span className={`whats-new-icon is-${h.icon}`} aria-hidden="true">
                    <Icon name={h.icon} />
                  </span>
                  <span className="whats-new-text">
                    <span className="whats-new-head">{h.title}</span>
                    <span className="whats-new-body">{h.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={() => void window.loom.updateNotes(newest)}>
            All changes
          </button>
          <button className="btn primary" data-choice="ok" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
