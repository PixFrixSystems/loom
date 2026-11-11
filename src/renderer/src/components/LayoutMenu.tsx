import { LayoutGrid } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LayoutNode } from '@shared/types'
import { panesOf, presetLayout, presetOf, PRESETS, type PresetName } from '../lib/layout'
import { useStore } from '../store'

type Box = { x: number; y: number; w: number; h: number }

function boxesOf(node: LayoutNode, b: Box, gap: number): Box[] {
  if (node.kind === 'pane') return [b]
  const row = node.dir === 'row'
  const free = (row ? b.w : b.h) - gap * (node.children.length - 1)
  let at = row ? b.x : b.y
  return node.children.flatMap((c, i) => {
    const len = free * node.sizes[i]
    const box = row ? { x: at, y: b.y, w: len, h: b.h } : { x: b.x, y: at, w: b.w, h: len }
    at += len + gap
    return boxesOf(c, box, gap)
  })
}

/** A small drawing of a layout's shape. */
function Diagram({ name }: { name: PresetName }): ReactNode {
  const boxes = boxesOf(presetLayout(name, []), { x: 0.5, y: 0.5, w: 35, h: 23 }, 2)
  return (
    <svg width="36" height="24" viewBox="0 0 36 24" aria-hidden="true">
      {boxes.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="2" />
      ))}
    </svg>
  )
}

function LayoutPopover({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const layout = useStore((s) => s.layout)
  const current = presetOf(layout)
  const multi = panesOf(layout).length > 1
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.layout-btn')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const s = useStore.getState()
  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return createPortal(
    <div ref={ref} className="menu layout-pop" style={{ right: Math.max(8, window.innerWidth - anchor.right), top: anchor.bottom + 6 }} role="dialog" aria-label="Layout">
      <div className="layout-presets">
        {PRESETS.map((p) => (
          <button key={p.name} className={`layout-preset${current === p.name ? ' on' : ''}`} aria-pressed={current === p.name} onClick={act(() => s.applyPreset(p.name))}>
            <Diagram name={p.name} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      <div className="menu-sep" role="separator" />
      <button className="menu-item" onClick={act(() => s.splitPane('right'))}>
        <span className="menu-check" />
        <span className="menu-label">Split to the right</span>
        <span className="menu-key">Ctrl+\</span>
      </button>
      <button className="menu-item" onClick={act(() => s.splitPane('bottom'))}>
        <span className="menu-check" />
        <span className="menu-label">Split down</span>
        <span className="menu-key">Ctrl+Shift+\</span>
      </button>
      <button className="menu-item" disabled={!multi} onClick={act(() => s.closePane())}>
        <span className="menu-check" />
        <span className="menu-label">Close this pane</span>
      </button>
      <p className="layout-tip">Drag a tab onto a pane to show it there, or onto a pane's edge to split it. Ctrl+Alt+arrows move between panes.</p>
    </div>,
    document.body
  )
}

export function LayoutButton(): ReactNode {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const multi = useStore((s) => s.layout.kind === 'split')
  return (
    <>
      <button
        className={`icon-btn topbar-btn layout-btn${multi || anchor ? ' on' : ''}`}
        title="Layout: split the work area"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        <LayoutGrid />
      </button>
      {anchor ? <LayoutPopover anchor={anchor} onClose={() => setAnchor(null)} /> : null}
    </>
  )
}
