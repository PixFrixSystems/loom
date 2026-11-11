import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, type MenuItem } from '../store'

function MenuList({
  items,
  x,
  y,
  onClose,
  minWidth = 180
}: {
  items: MenuItem[]
  x: number
  y: number
  onClose: () => void
  minWidth?: number
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState(-1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - r.width - 6)
    const ny = Math.min(y, window.innerHeight - r.height - 6)
    setPos({ x: Math.max(6, nx), y: Math.max(6, ny) })
    el.focus()
  }, [x, y])

  const actionable = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0)

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = actionable.indexOf(focus)
      const next = e.key === 'ArrowDown' ? actionable[(cur + 1) % actionable.length] : actionable[(cur - 1 + actionable.length) % actionable.length]
      setFocus(next ?? -1)
    } else if (e.key === 'Enter' && focus >= 0) {
      e.preventDefault()
      const it = items[focus]
      if (it.submenu) return
      it.onSelect?.()
      onClose()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y, minWidth }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${it.danger ? ' danger' : ''}${focus === i ? ' focused' : ''}`}
            disabled={it.disabled}
            onMouseEnter={(e) => {
              setFocus(i)
              if (it.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ index: i, x: r.right + 2, y: r.top - 4 })
              } else setSub(null)
            }}
            onClick={() => {
              if (it.submenu) return
              it.onSelect?.()
              onClose()
            }}
          >
            <span className="menu-check">{it.checked ? <Check /> : null}</span>
            <span className="menu-label">{it.label}</span>
            {it.submenu ? <ChevronRight className="menu-sub" /> : null}
          </button>
        )
      )}
      {sub && items[sub.index]?.submenu ? (
        <MenuList items={items[sub.index].submenu!} x={sub.x} y={sub.y} onClose={onClose} />
      ) : null}
    </div>
  )
}

/** One context menu at a time, opened through the store. */
export function ContextMenuHost(): ReactNode {
  const menu = useStore((s) => s.menu)
  const close = (): void => useStore.getState().set({ menu: null })
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.menu')) close()
    }
    const onBlur = (): void => close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [menu])
  if (!menu) return null
  return createPortal(<MenuList items={menu.items} x={menu.x} y={menu.y} onClose={close} />, document.body)
}

/** A dropdown that looks like a field and opens a themed list. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  className = '',
  title,
  placement = 'below'
}: {
  value: T
  options: { value: T; label: string; description?: string }[]
  onChange: (v: T) => void
  label?: ReactNode
  icon?: ReactNode
  className?: string
  title?: string
  placement?: 'below' | 'above'
}): ReactNode {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !list.current || !btn.current) return
    const b = btn.current.getBoundingClientRect()
    const l = list.current
    const h = l.offsetHeight
    const top = placement === 'above' || b.bottom + h + 8 > window.innerHeight ? b.top - h - 4 : b.bottom + 4
    l.style.top = `${Math.max(6, top)}px`
    l.style.left = `${Math.min(b.left, window.innerWidth - l.offsetWidth - 6)}px`
    const sel = l.querySelector<HTMLElement>('[aria-selected="true"]') ?? l.querySelector<HTMLElement>('button')
    sel?.focus()
  }, [open, placement])

  const onListKey = (e: React.KeyboardEvent): void => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(i + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btn.current?.focus()
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dropdown ${className}${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="dropdown-value">{label ?? current?.label ?? value}</span>
        <svg className="dropdown-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div ref={list} className="menu dropdown-list" role="listbox" onKeyDown={onListKey}>
              {options.map((o) => (
                <button
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className="menu-item"
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                    btn.current?.focus()
                  }}
                >
                  <span className="menu-check">{o.value === value ? <Check /> : null}</span>
                  <span className="menu-label">
                    {o.label}
                    {o.description ? <span className="menu-desc">{o.description}</span> : null}
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
