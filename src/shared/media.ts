// The files Loom shows rather than edits: pictures, videos and sound, by extension.

export type MediaKind = 'image' | 'video' | 'audio'

/** Extension to its kind and the type browsers know it by. SVG is left out: it opens as text, to edit. */
export const MEDIA_TYPES: Record<string, [MediaKind, string]> = {
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  jfif: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  avif: ['image', 'image/avif'],
  bmp: ['image', 'image/bmp'],
  ico: ['image', 'image/x-icon'],
  mp4: ['video', 'video/mp4'],
  m4v: ['video', 'video/mp4'],
  mov: ['video', 'video/quicktime'],
  webm: ['video', 'video/webm'],
  mkv: ['video', 'video/x-matroska'],
  ogv: ['video', 'video/ogg'],
  mp3: ['audio', 'audio/mpeg'],
  wav: ['audio', 'audio/wav'],
  ogg: ['audio', 'audio/ogg'],
  oga: ['audio', 'audio/ogg'],
  opus: ['audio', 'audio/ogg'],
  m4a: ['audio', 'audio/mp4'],
  aac: ['audio', 'audio/aac'],
  flac: ['audio', 'audio/flac']
}

export function mediaType(path: string): [MediaKind, string] | null {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] ?? null) : null
}

/** A picture, a video or sound, or null for anything Loom opens as text. */
export function mediaKind(path: string): MediaKind | null {
  return mediaType(path)?.[0] ?? null
}

/** What the window needs to show a media file */
export interface MediaInfo {
  kind: MediaKind
  /** Where to load it from: a private address that streams the file */
  url: string
  size: number
  mtime: number
}
