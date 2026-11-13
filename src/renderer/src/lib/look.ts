import { isVideo, readLook } from '@shared/look'
import { LOOK_AREAS, type AreaPicture, type Look, type LookArea } from '@shared/types'
import { useStore } from '../store'

/**
 * Pictures and videos behind areas, and decorations (Settings, Pictures and decorations), worn over
 * whichever theme is chosen. Each area's picture is a ::before layer under that area's content; a
 * video is a <video> in the same place (components/LookVideo.tsx). Both are styled by rules written
 * into a style element here. Everything else is a data-look-* switch on <html> that styles/look.css
 * follows, so its colours come from the theme. Popouts wear it too: their settings follow the main
 * window's.
 */

/** The element each area's picture sits under */
const AREA: Record<LookArea, string> = {
  window: ':is(.app, .popout)',
  chat: '.chat',
  sidebar: '.sidebar',
  files: '.rightpanel',
  composer: '.composer'
}

/** The message box is rounded, and so is its picture */
const ROUND: Partial<Record<LookArea, string>> = { composer: '14px' }

const urls = new Map<string, Promise<string | null>>()

/** One of Loom's kept pictures as a blob: URL, read once. The page may show blob: but not files. */
export function pictureUrl(file: string): Promise<string | null> {
  let url = urls.get(file)
  if (!url) {
    url = window.loom
      .readPicture(file)
      .then((r) => (r ? URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.type })) : null))
      .catch(() => null)
    urls.set(file, url)
  }
  return url
}

/** Lets go of the pictures the look no longer uses */
function forget(keep: string[]): void {
  for (const [file, url] of urls) {
    if (keep.includes(file)) continue
    urls.delete(file)
    void url.then((u) => u && URL.revokeObjectURL(u))
  }
}

/** Fading into the edges: around the focus point for Fill, away from the side the picture sits on for Fit */
function fadeMask(p: AreaPicture): string | null {
  if (!p.fade) return null
  if (p.size === 'fill') return `radial-gradient(ellipse 80% 90% at ${p.x}% ${p.y}%, #000 40%, transparent 100%)`
  if (p.x >= 67) return 'linear-gradient(to left, #000 30%, transparent 80%)'
  if (p.x <= 33) return 'linear-gradient(to right, #000 30%, transparent 80%)'
  return `radial-gradient(ellipse 60% 90% at 50% ${p.y}%, #000 40%, transparent 100%)`
}

/**
 * One area's picture or video: a layer under the area's content, over its own colour. The focus
 * point is a background-position (object-position for a video), which lines that point of the
 * picture up with the same point of the area. Blur needs room for its soft edge, which the clip then
 * cuts back to the area's shape.
 */
function layer(area: LookArea, p: AreaPicture, url: string): string {
  const spread = p.blur * 2
  const mask = fadeMask(p)
  const fit = p.size === 'fill' ? 'cover' : 'contain'
  // The whole window's picture is drawn whole: it shows through the panes' own colours (look.css).
  const opacity = area === 'window' ? 1 : p.opacity / 100
  const look = [
    `  opacity: ${opacity};`,
    p.blur ? `  filter: blur(${p.blur}px);` : '',
    `  clip-path: inset(${spread}px round ${ROUND[area] ?? '0'});`,
    mask ? `  -webkit-mask-image: ${mask}; mask-image: ${mask};` : ''
  ]
  const place = isVideo(p.file)
    ? [
        `${AREA[area]} > .look-video[data-area='${area}'] {`,
        `  position: absolute; top: ${-spread}px; left: ${-spread}px; z-index: -1; pointer-events: none;`,
        `  width: calc(100% + ${spread * 2}px); height: calc(100% + ${spread * 2}px);`,
        `  object-fit: ${fit}; object-position: ${p.x}% ${p.y}%;`
      ]
    : [
        `${AREA[area]}::before {`,
        `  content: ''; position: absolute; inset: ${-spread}px; z-index: -1; pointer-events: none;`,
        `  background: url("${url}") ${p.x}% ${p.y}% / ${fit} no-repeat;`
      ]
  return [`${AREA[area]} { position: relative; isolation: isolate; }`, ...place, ...look, '}'].filter(Boolean).join('\n')
}

let style: HTMLStyleElement | null = null

/** Puts a look on the page; `shown` has the URL of each picture that could be read */
function wear(look: Look, shown: Partial<Record<LookArea, string>>): void {
  const root = document.documentElement.dataset
  const flag = (name: 'lookWindow' | 'lookGlass' | 'lookBoxes' | 'lookGlow' | 'lookCorners' | 'lookBanner' | 'lookDividers', on: boolean): void => {
    if (on) root[name] = ''
    else delete root[name]
  }
  const win = shown.window ? look.pictures.window : undefined
  const vars = [`--look-box: ${look.boxes}%;`, `--look-glass-blur: ${look.glassBlur}px;`]
  // The window's picture: the panes keep this much of their colour over it, glass panels less.
  if (win) vars.push(`--look-wash: ${100 - win.opacity}%;`, `--look-glass-wash: ${Math.max(35, 100 - Math.round(win.opacity * 1.6))}%;`)
  const layers = LOOK_AREAS.flatMap(({ value }) => {
    const p = look.pictures[value]
    const url = shown[value]
    return p && url ? [layer(value, p, url)] : []
  })
  style ??= document.head.appendChild(document.createElement('style'))
  // Only numbers checked by readLook and blob: URLs made above end up in this text.
  style.textContent = [`:root { ${vars.join(' ')} }`, ...layers].join('\n')
  flag('lookWindow', !!win)
  flag('lookGlass', look.glass)
  flag('lookBoxes', look.boxes < 100)
  flag('lookGlow', look.glow)
  flag('lookCorners', look.corners)
  flag('lookBanner', look.banner)
  flag('lookDividers', look.dividers)
  if (look.pattern === 'none') delete root.lookPattern
  else root.lookPattern = look.pattern
}

/** Wears the look from settings once they've loaded, and again whenever it changes */
export function startWearingLook(): void {
  let key = ''
  let turn = 0
  useStore.subscribe((s) => {
    if (!s.ready) return
    const look = readLook(s.settings.look)
    const next = JSON.stringify(look)
    if (next === key) return
    key = next
    const mine = ++turn
    const areas = LOOK_AREAS.flatMap(({ value }) => {
      const p = look.pictures[value]
      return p ? [{ area: value, file: p.file }] : []
    })
    void Promise.all(areas.map(async ({ area, file }) => [area, await pictureUrl(file)] as const)).then((pairs) => {
      // A newer look came while these pictures loaded: that one is worn instead.
      if (mine !== turn) return
      const shown: Partial<Record<LookArea, string>> = {}
      for (const [area, url] of pairs) if (url?.startsWith('blob:')) shown[area] = url
      wear(look, shown)
      forget(areas.map((a) => a.file))
    })
  })
}
