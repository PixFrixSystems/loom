import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, type MenuItem } from '../store'

function MenuList({
  items,
  x,
  y,
  onClose,
  minWidth = 180,
  takeFocus = true,
  onBack
}: {
  items: MenuItem[]
  x: number
  y: number
  onClose: () => void
  minWidth?: number
  /** A submenu opened by hovering leaves the keyboard where it was; one opened by key takes it. */
  takeFocus?: boolean
  /** ArrowLeft in a submenu goes back to the menu it came from. */
  onBack?: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number; byKey: boolean } | null>(null)
  const [focus, setFocus] = useState(takeFocus && onBack ? -2 : -1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - r.width - 6)
    const ny = Math.min(y, window.innerHeight - r.height - 6)
    setPos({ x: Math.max(6, nx), y: Math.max(6, ny) })
    if (takeFocus) el.focus()
  }, [x, y])

  // A submenu with nothing in it (Move to project with one project, say) can't be picked.
  const usable = (it: MenuItem): boolean => !it.separator && !it.disabled && !(it.submenu && !it.submenu.length)
  const actionable = items.map((it, i) => (usable(it) ? i : -1)).filter((i) => i >= 0)
  // A submenu opened by key starts on its first item.
  useEffect(() => {
    if (focus === -2) setFocus(actionable[0] ?? -1)
  }, [])

  const openSub = (i: number, byKey: boolean): void => {
    const el = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[items.slice(0, i).filter((it) => !it.separator).length]
    const r = el?.getBoundingClientRect()
    if (r) setSub({ index: i, x: r.right + 2, y: r.top - 4, byKey })
  }

  const onKey = (e: React.KeyboardEvent): void => {
    // Keys pressed in a submenu are its own; the menu around it must not act on them too.
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!actionable.length) return
      const cur = actionable.indexOf(focus)
      const next =
        cur < 0
          ? actionable[e.key === 'ArrowDown' ? 0 : actionable.length - 1]
          : actionable[(cur + (e.key === 'ArrowDown' ? 1 : actionable.length - 1)) % actionable.length]
      setFocus(next)
      setSub(null)
    } else if ((e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') && focus >= 0) {
      e.preventDefault()
      const it = items[focus]
      if (it.submenu) return openSub(focus, true)
      if (e.key === 'ArrowRight') return
      it.onSelect?.()
      onClose()
    } else if (e.key === 'ArrowLeft' && onBack) {
      e.preventDefault()
      onBack()
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
            disabled={!usable(it)}
            aria-haspopup={it.submenu ? 'menu' : undefined}
            aria-expanded={it.submenu ? sub?.index === i : undefined}
            onMouseEnter={(e) => {
              setFocus(i)
              if (it.submenu && usable(it)) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ index: i, x: r.right + 2, y: r.top - 4, byKey: false })
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
        <MenuList
          items={items[sub.index].submenu!}
          x={sub.x}
          y={sub.y}
          onClose={onClose}
          takeFocus={sub.byKey}
          onBack={() => {
            setSub(null)
            ref.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

/** One context menu at a time, opened through the store. */
export function ContextMenuHost(): ReactNode {
  const menu = useStore((s) => s.menu)
  const close = (): void => useStore.getState().set({ menu: null })
  // The keyboard goes back to where it was when the menu closes.
  useEffect(() => {
    if (!menu) return
    const before = document.activeElement as HTMLElement | null
    return () => {
      if (before && document.contains(before) && !document.activeElement?.closest('.confirm')) before.focus({ preventScroll: true })
    }
  }, [menu])
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
