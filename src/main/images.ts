// Images people attached to their messages. The renderer gets small thumbnails; the full image
// stays here and is fetched when someone opens it.

import { nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import type { ChatItem, ImagePreview } from '@shared/types'

const THUMB_SIDE = 400
/** Base64 characters kept for full-size viewing, oldest dropped first. */
const MAX_KEPT = 200 * 1024 * 1024

const kept = new Map<string, { mediaType: string; data: string }>()
let keptSize = 0

/** Remembers an attached image and returns a reference to it. The same image always gets the same one. */
export function keepImage(mediaType: string, data: string): string {
  const ref = createHash('sha1').update(data).digest('hex')
  if (kept.has(ref)) {
    // Most recently used goes to the back of the line.
    const v = kept.get(ref)!
    kept.delete(ref)
    kept.set(ref, v)
    return ref
  }
  kept.set(ref, { mediaType, data })
  keptSize += data.length
  while (keptSize > MAX_KEPT && kept.size > 1) {
    const [oldest, v] = kept.entries().next().value as [string, { data: string }]
    kept.delete(oldest)
    keptSize -= v.data.length
  }
  return ref
}

export function fullImage(ref: string): string | null {
  const v = kept.get(ref)
  return v ? `data:${v.mediaType};base64,${v.data}` : null
}

const thumbs = new Map<string, string | null>()

function thumbnail(ref: string): string | null {
  if (thumbs.has(ref)) return thumbs.get(ref)!
  const v = kept.get(ref)
  if (!v) return null
  let out: string | null = null
  const img = nativeImage.createFromBuffer(Buffer.from(v.data, 'base64'))
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    const scale = Math.min(1, THUMB_SIDE / Math.max(width, height))
    const small = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img
    out = v.mediaType === 'image/jpeg' ? `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}` : small.toDataURL()
  } else if (v.data.length < 600_000) {
    // A format Electron can't decode (WebP, GIF): small enough to show as it is.
    out = `data:${v.mediaType};base64,${v.data}`
  }
  thumbs.set(ref, out)
  return out
}

/** Fills in thumbnails for the user messages that will actually be shown. */
export function fillThumbnails(items: ChatItem[]): void {
  for (const item of items) {
    if (item.kind !== 'user' || !item.previews) continue
    item.previews = item.previews.map((p): ImagePreview => (p.thumb || !p.ref ? p : { ...p, thumb: thumbnail(p.ref) }))
  }
}
