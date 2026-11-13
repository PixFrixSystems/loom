import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isVideo, readLook } from '@shared/look'
import type { LookArea } from '@shared/types'
import { pictureUrl } from '../lib/look'
import { useStore } from '../store'

const lessMotion = matchMedia('(prefers-reduced-motion: reduce)')

/** Whether this window is on screen, as the main process tells it (document.hidden can miss a minimise) */
let shown = true
const following = new Set<() => void>()
window.loom.onShown((v) => {
  shown = v
  for (const f of following) f()
})

/**
 * An area's background video (Settings, Pictures and decorations): muted, looping, under the area's
 * content, and styled like a picture by lib/look.ts. Nothing when the area has no video. It pauses
 * while the window is minimised or hidden, and with Windows' animation effects off it stays on its
 * first frame.
 */
export function LookVideo({ area }: { area: LookArea }): ReactNode {
  const file = useStore((s) => {
    const p = readLook(s.settings.look).pictures[area]
    return p && isVideo(p.file) ? p.file : null
  })
  const [url, setUrl] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setUrl(null)
    if (!file) return
    let live = true
    void pictureUrl(file).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [file])

  useEffect(() => {
    const v = video.current
    if (!v) return
    const follow = (): void => {
      if (!shown || document.hidden || lessMotion.matches) v.pause()
      else void v.play().catch(() => undefined)
    }
    follow()
    following.add(follow)
    document.addEventListener('visibilitychange', follow)
    lessMotion.addEventListener('change', follow)
    return () => {
      following.delete(follow)
      document.removeEventListener('visibilitychange', follow)
      lessMotion.removeEventListener('change', follow)
    }
  }, [url])

  if (!url) return null
  return <video ref={video} className="look-video" data-area={area} src={url} muted loop playsInline preload="auto" aria-hidden="true" />
}
