import { LOOK_AREAS, type AreaPicture, type Look, type LookPattern } from './types'

/**
 * The name Loom gives its copy of a picture or video: random hex and the file's real type. It is the
 * only name that ever reaches the page or the file system, so no path from outside can.
 */
export const PICTURE_FILE = /^[0-9a-f]{16}\.(png|jpg|webp|gif|mp4|webm)$/

export const PICTURE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm'
} as const

export type PictureKind = keyof typeof PICTURE_TYPES

/** Videos play in a <video> layer; pictures are a CSS background */
export const isVideo = (file: string): boolean => /\.(mp4|webm)$/.test(file)

/** Past this a picture starts to compete with the text over it */
export const MAX_OPACITY = 40

const PATTERNS: LookPattern[] = ['none', 'scanlines', 'dots', 'stars']

/** No pictures, no decorations: Loom as the theme draws it */
export const PLAIN_LOOK: Look = {
  pictures: {},
  boxes: 100,
  glass: false,
  glassBlur: 4,
  glow: false,
  corners: false,
  banner: false,
  dividers: false,
  pattern: 'none'
}

/** A whole number from min to max, or the fallback for anything that isn't a number */
const whole = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

/** One area's picture, checked; null when it names no copy of Loom's */
export function readPicture(raw: unknown): AreaPicture | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.file !== 'string' || !PICTURE_FILE.test(p.file)) return null
  return {
    file: p.file,
    opacity: whole(p.opacity, 0, MAX_OPACITY, 24),
    size: p.size === 'fit' ? 'fit' : 'fill',
    x: whole(p.x, 0, 100, 50),
    y: whole(p.y, 0, 100, 50),
    blur: whole(p.blur, 0, 16, 0),
    fade: p.fade === true
  }
}

/** The look in settings, checked: whatever is malformed (a hand-edited loom-state.json) is left out or reset */
export function readLook(raw: unknown): Look {
  if (!raw || typeof raw !== 'object') return PLAIN_LOOK
  const l = raw as Record<string, unknown>
  const given = l.pictures && typeof l.pictures === 'object' ? (l.pictures as Record<string, unknown>) : {}
  const pictures: Look['pictures'] = {}
  for (const { value } of LOOK_AREAS) {
    const p = readPicture(given[value])
    if (p) pictures[value] = p
  }
  return {
    pictures,
    boxes: whole(l.boxes, 50, 100, 100),
    glass: l.glass === true,
    glassBlur: whole(l.glassBlur, 0, 14, 4),
    glow: l.glow === true,
    corners: l.corners === true,
    banner: l.banner === true,
    dividers: l.dividers === true,
    pattern: PATTERNS.includes(l.pattern as LookPattern) ? (l.pattern as LookPattern) : 'none'
  }
}

/** The picture files a look uses */
export function lookFiles(raw: unknown): string[] {
  return Object.values(readLook(raw).pictures).flatMap((p) => (p ? [p.file] : []))
}
