// Images people attached to their messages. The renderer gets small thumbnails; the full image
// stays here and is fetched when someone opens it.

import { nativeImage, type NativeImage } from 'electron'
import { createHash } from 'node:crypto'
import type { ChatItem, ImagePreview } from '@shared/types'

const THUMB_SIDE = 400
/** Thumbnails kept, least recently used dropped first. */
const MAX_THUMBS = 300
/** New thumbnails made on the spot by fillThumbnails; the rest wait for finishThumbnails. */
const SYNC_THUMBS = 4
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

/** A thumbnail made before, if any (undefined when there is none yet). */
function cachedThumbnail(ref: string): string | null | undefined {
  if (!thumbs.has(ref)) return undefined
  // Most recently used goes to the back of the line.
  const v = thumbs.get(ref)!
  thumbs.delete(ref)
  thumbs.set(ref, v)
  return v
}

/** Any pixel that isn't fully opaque. Checked on the thumbnail (400 px at most), so it is quick. */
function seeThrough(img: NativeImage): boolean {
  const px = img.toBitmap()
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return true
  return false
}

function makeThumbnail(ref: string): string | null {
  const v = kept.get(ref)
  if (!v) return null
  let out: string | null = null
  const img = nativeImage.createFromBuffer(Buffer.from(v.data, 'base64'))
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    const scale = Math.min(1, THUMB_SIDE / Math.max(width, height))
    const small = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img
    // JPEG is a fraction of PNG's size for screenshots and photos. A picture with see-through parts
    // stays PNG, since JPEG would turn them black.
    out = v.mediaType !== 'image/jpeg' && seeThrough(small) ? small.toDataURL() : `data:image/jpeg;base64,${small.toJPEG(80).toString('base64')}`
  } else if (v.data.length < 600_000) {
    // A format Electron can't decode (WebP, GIF): small enough to show as it is.
    out = `data:${v.mediaType};base64,${v.data}`
  }
  thumbs.set(ref, out)
  while (thumbs.size > MAX_THUMBS) thumbs.delete(thumbs.keys().next().value as string)
  return out
}

/**
 * Fills in thumbnails for the user messages that will actually be shown: the ones made before,
 * and up to a few new ones (one message's worth, when a chat sends it). Decoding and resizing
 * happen in the main process, so a whole chat's worth is left to finishThumbnails.
 */
export function fillThumbnails(items: ChatItem[]): void {
  let budget = SYNC_THUMBS
  for (const item of items) {
    if (item.kind !== 'user' || !item.previews) continue
    item.previews = item.previews.map((p): ImagePreview => {
      if (p.thumb || !p.ref) return p
      const thumb = cachedThumbnail(p.ref)
      if (thumb !== undefined) return { ...p, thumb }
      if (budget <= 0) return p
      budget--
      return { ...p, thumb: makeThumbnail(p.ref) }
    })
  }
}

/**
 * Makes the thumbnails fillThumbnails left out, one image at a time with a turn of the event loop
 * in between, so opening a chat with hundreds of images doesn't freeze every window.
 */
export async function finishThumbnails(items: ChatItem[]): Promise<void> {
  for (const item of items) {
    if (item.kind !== 'user' || !item.previews) continue
    const previews: ImagePreview[] = []
    for (const p of item.previews) {
      if (p.thumb || !p.ref) {
        previews.push(p)
        continue
      }
      let thumb = cachedThumbnail(p.ref)
      if (thumb === undefined) {
        await new Promise((resolve) => setImmediate(resolve))
        thumb = makeThumbnail(p.ref)
      }
      previews.push({ ...p, thumb })
    }
    item.previews = previews
  }
}
