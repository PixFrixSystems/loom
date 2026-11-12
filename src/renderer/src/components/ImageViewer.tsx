import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

/** Full-size view of an image attached to a message. Arrow keys move between that message's images. */
export function ImageViewer(): ReactNode {
  const viewer = useStore((s) => s.viewer)
  const [src, setSrc] = useState<string | null>(null)
  const current = viewer ? viewer.images[viewer.index] : undefined

  // Before the frame is drawn, so the previous image never flashes up first.
  useLayoutEffect(() => {
    if (!current) return
    let gone = false
    setSrc(current.full ?? current.thumb)
    if (!current.full && current.ref) {
      void window.loom.fullImage(current.ref).then((url) => {
        if (!gone && url) setSrc(url)
      })
    }
    return () => {
      gone = true
    }
  }, [current])

  useEffect(() => {
    if (!viewer) return
    const count = viewer.images.length
    const onKey = (e: KeyboardEvent): void => {
      const set = useStore.getState().set
      if (e.key === 'Escape') set({ viewer: null })
      else if (e.key === 'ArrowRight' && count > 1) set({ viewer: { ...viewer, index: (viewer.index + 1) % count } })
      else if (e.key === 'ArrowLeft' && count > 1) set({ viewer: { ...viewer, index: (viewer.index + count - 1) % count } })
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [viewer])

  if (!viewer || !current) return null
  const count = viewer.images.length
  const close = (): void => useStore.getState().set({ viewer: null })
  const go = (step: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    useStore.getState().set({ viewer: { ...viewer, index: (viewer.index + step + count) % count } })
  }

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Attached image" onClick={close}>
      <button className="icon-btn viewer-close" title="Close (Esc)" aria-label="Close" onClick={close}>
        <X />
      </button>
      {count > 1 ? (
        <button className="icon-btn viewer-nav viewer-prev" title="Previous image" aria-label="Previous image" onClick={go(-1)}>
          <ChevronLeft />
        </button>
      ) : null}
      {src ? (
        <img key={viewer.index} className="viewer-img" src={src} alt="" draggable={false} onClick={(e) => e.stopPropagation()} />
      ) : (
        <p className="viewer-missing">This image is no longer available.</p>
      )}
      {count > 1 ? (
        <>
          <button className="icon-btn viewer-nav viewer-next" title="Next image" aria-label="Next image" onClick={go(1)}>
            <ChevronRight />
          </button>
          <span className="viewer-count">
            {viewer.index + 1} of {count}
          </span>
        </>
      ) : null}
    </div>,
    document.body
  )
}
