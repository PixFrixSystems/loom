import { useEffect } from 'react'

/**
 * While a divider is being dragged, pages in preview panes stop taking the mouse.
 * Otherwise a page swallows the pointer as soon as the drag crosses it, and the divider stops.
 */
export function useResizing(active: boolean): void {
  useEffect(() => {
    if (!active) return
    document.body.classList.add('is-resizing')
    return () => document.body.classList.remove('is-resizing')
  }, [active])
}
