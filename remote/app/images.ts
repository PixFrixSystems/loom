// Pictures attached to a message on the phone. A photo straight off a phone camera is several
// megabytes; a message travels sealed, as one piece, through the relay, so each picture is made
// smaller first: scaled down and saved as a JPEG until it fits.

import { MAX_IMAGE_CHARS, type RemoteImage } from '@shared/remote'

export interface Attached extends RemoteImage {
  id: string
  /** A small copy for the message box and the bubble */
  thumb: string
}

/** The longest side and JPEG quality tried in turn, until the picture is small enough to send */
const TRIES: [side: number, quality: number][] = [
  [1568, 0.85],
  [1568, 0.72],
  [1280, 0.72],
  [1024, 0.68],
  [800, 0.6]
]

function draw(img: HTMLImageElement, side: number): HTMLCanvasElement {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  // A JPEG has no see-through parts: what was transparent goes white, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A picked file made ready to send, or null when the browser can't read it as a picture. */
export async function prepare(file: Blob): Promise<Attached | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) return null
    for (const [side, quality] of TRIES) {
      const blob = await jpeg(draw(img, side), quality)
      if (!blob) continue
      const data = await base64(blob)
      if (data.length > MAX_IMAGE_CHARS) continue
      return { id: crypto.randomUUID(), mediaType: 'image/jpeg', data, thumb: draw(img, 200).toDataURL('image/jpeg', 0.72) }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
