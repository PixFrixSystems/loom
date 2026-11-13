// Themes made in Settings: the 17 seed colours in, every colour Loom needs out. Seeds come from
// Claude, from the colour pickers or from the saved file, so nothing is trusted: a colour is used
// only if it is exactly '#rrggbb', which also keeps anything else out of the CSS built from it.
// Everything that goes on screen is made readable here, whatever the seeds were.

import { THEME_SEEDS, type CustomTheme, type ThemeSeeds } from './types'

const HEX = /^#[0-9a-f]{6}$/
const ID = /^custom-[a-z0-9-]{1,64}$/

export const isCustomThemeId = (v: unknown): v is CustomTheme['id'] => typeof v === 'string' && ID.test(v)

/** Seeds from anything: every one of the 17 present and a '#rrggbb' colour (any case), or null. */
export function readSeeds(raw: unknown): ThemeSeeds | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Partial<ThemeSeeds> = {}
  for (const { key } of THEME_SEEDS) {
    const v = (raw as Record<string, unknown>)[key]
    const colour = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (!HEX.test(colour)) return null
    out[key] = colour
  }
  return out as ThemeSeeds
}

/** A theme name as plain text on one line, at most 40 characters */
export function cleanThemeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return name.slice(0, 40) || 'My theme'
}

/** The saved themes that are safe to use; anything malformed is left out. */
export function readCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return []
  const out: CustomTheme[] = []
  for (const t of raw) {
    const colours = readSeeds(t?.colours)
    if (isCustomThemeId(t?.id) && colours && !out.some((o) => o.id === t.id)) out.push({ id: t.id, name: cleanThemeName(t.name), colours })
  }
  return out
}

// ---------- Colour arithmetic ----------

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]): string => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

/** `a` moved `t` of the way (0 to 1) towards `b` */
export const mix = (a: string, b: string, t: number): string => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t))

const luminance = (hex: string): number =>
  rgb(hex)
    .map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)

/** WCAG contrast ratio, 1 to 21 */
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** `colour` moved towards `to` in small steps until it reaches `ratio` against every surface */
function lift(colour: string, surfaces: string[], ratio: number, to = '#ffffff'): string {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(colour, to, t)
    if (surfaces.every((s) => contrast(c, s) >= ratio)) return c
  }
  return to
}

/** `colour` darkened until it is no brighter than `max` luminance: Loom's themes stay dark. */
function darkAtMost(colour: string, max: number): string {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(colour, '#000000', t)
    if (luminance(c) <= max) return c
  }
  return '#000000'
}

const rgba = (hex: string, alpha: number): string => `rgba(${rgb(hex).join(', ')}, ${alpha})`
/** '#rrggbbaa', for the editor, which takes no rgba() */
const hexAlpha = (hex: string, alpha: number): string => hex + Math.round(alpha * 255).toString(16).padStart(2, '0')

// ---------- From seeds to a whole theme ----------

/**
 * The seeds as they will be shown: backgrounds kept dark (Loom's white washes need a dark ground),
 * text, status and code colours lifted to 4.5:1 on every surface they sit on (comments to 3:1).
 * Only what fails moves, and only as far as it must.
 */
export function readableSeeds(s: ThemeSeeds): ThemeSeeds {
  const background = darkAtMost(s.background, 0.04)
  const surface = darkAtMost(s.surface, 0.07)
  const well = darkAtMost(s.well, 0.05)
  const grounds = [background, surface, well]
  const code = (c: string, ratio = 4.5): string => lift(c, [well, surface], ratio)
  return {
    background,
    surface,
    well,
    text: lift(s.text, grounds, 7),
    muted: lift(s.muted, grounds, 4.5),
    accent: lift(s.accent, grounds, 4.5),
    ok: lift(s.ok, grounds, 4.5),
    warn: lift(s.warn, grounds, 4.5),
    danger: lift(s.danger, grounds, 4.5),
    comment: code(s.comment, 3),
    keyword: code(s.keyword),
    string: code(s.string),
    number: code(s.number),
    type: code(s.type),
    function: code(s.function),
    variable: code(s.variable),
    tag: code(s.tag)
  }
}

/** The title bar and the window behind everything: the background a step darker */
const topOf = (s: ThemeSeeds): string => mix(s.background, '#000000', 0.18)

/** What the main process paints itself, as for the built-in themes */
export function customFrame(seeds: ThemeSeeds): { background: string; titleBar: string; symbols: string } {
  const s = readableSeeds(seeds)
  const top = topOf(s)
  return { background: top, titleBar: top, symbols: mix(s.text, s.muted, 0.5) }
}

/** The page's colours: the same tokens a built-in theme sets in tokens.css */
export function customTokens(seeds: ThemeSeeds): Record<string, string> {
  const s = readableSeeds(seeds)
  const top = topOf(s)
  const deep = mix(s.background, '#000000', 0.3)
  const light = mix(s.accent, '#ffffff', 0.4)
  // Text on accent-coloured buttons: the background if it reads, else black
  const ink = contrast(s.background, s.accent) >= 4.5 ? s.background : '#000000'
  // The selection behind white text: the accent darkened until white reads on it
  let brandDeep = s.accent
  for (let t = 0; t <= 1 && contrast('#ffffff', brandDeep) < 4.5; t += 0.02) brandDeep = mix(s.accent, '#000000', t)
  return {
    '--bg-deep': deep,
    '--window': top,
    '--bg': s.background,
    '--bg-shell': s.background,
    '--bg-top': top,
    '--bg-raised': s.surface,
    '--bg-input': s.surface,
    '--bg-sunken': s.well,
    '--text': s.text,
    '--text-2': mix(s.text, s.muted, 0.5),
    '--text-3': s.muted,
    '--brand': s.accent,
    '--brand-glow': rgba(s.accent, 0.55),
    '--brand-deep': brandDeep,
    '--light': light,
    '--light-glow': rgba(s.accent, 0.45),
    '--accent-hover': mix(s.accent, '#ffffff', 0.2),
    '--accent-ink': ink,
    '--accent-soft': rgba(s.accent, 0.14),
    '--accent-line': rgba(light, 0.35),
    '--ok': s.ok,
    '--ok-soft': rgba(s.ok, 0.16),
    '--warn': s.warn,
    '--warn-soft': rgba(s.warn, 0.16),
    '--danger': s.danger,
    '--danger-soft': rgba(s.danger, 0.14),
    '--glass': s.surface,
    '--float': rgba(s.surface, 0.97),
    '--bubble': s.surface,
    '--bubble-shadow': `inset 0 0 0 1px ${mix(s.surface, '#000000', 0.35)}`,
    '--lit-ink': deep,
    '--lit-shadow-hover': `inset 0 1px 0 #fff, 0 1px 2px rgba(0, 0, 0, 0.5), 0 14px 44px -8px ${rgba(s.accent, 0.7)}`,
    '--code-text': s.text,
    '--code-comment': s.comment,
    '--code-keyword': s.keyword,
    '--code-tag': s.tag,
    '--code-attr': s.number,
    '--code-string': s.string,
    '--code-type': s.type,
    '--code-variable': s.variable,
    '--code-number': s.number,
    '--code-function': s.function
  }
}

/** The code editor's colours, for lib/monaco.ts to turn into a Monaco theme */
export function customEditor(seeds: ThemeSeeds): { colors: Record<string, string>; tokens: Record<string, string> } {
  const s = readableSeeds(seeds)
  const edge = mix(s.surface, '#000000', 0.35)
  return {
    colors: {
      'editor.background': s.well,
      'editor.foreground': s.text,
      'editorLineNumber.foreground': mix(s.muted, s.well, 0.35),
      'editorLineNumber.activeForeground': s.text,
      'editor.lineHighlightBackground': mix(s.well, '#ffffff', 0.04),
      'editor.selectionBackground': hexAlpha(s.accent, 0.33),
      'editor.inactiveSelectionBackground': hexAlpha(s.accent, 0.18),
      'editorCursor.foreground': s.accent,
      'editorWidget.background': s.surface,
      'editorWidget.border': edge,
      'editorSuggestWidget.background': s.surface,
      'editorSuggestWidget.border': edge,
      'editorSuggestWidget.selectedBackground': mix(s.surface, '#ffffff', 0.08),
      'input.background': s.surface,
      'input.border': edge,
      'focusBorder': s.accent,
      'minimap.background': s.well,
      'diffEditor.unchangedRegionBackground': s.background,
      'diffEditor.unchangedRegionForeground': s.muted
    },
    tokens: {
      '': s.text,
      comment: s.comment,
      keyword: s.keyword,
      tag: s.tag,
      string: s.string,
      number: s.number,
      regexp: s.string,
      type: s.type,
      variable: s.variable,
      'attribute.name': s.number,
      'attribute.value': s.string,
      key: s.tag,
      'string.key.json': s.tag,
      delimiter: mix(s.text, s.muted, 0.5)
    }
  }
}

/** Terminal colours: the 16 ANSI colours drawn from the theme's own, on its well */
export function customTerminal(seeds: ThemeSeeds): Record<string, string> {
  const s = readableSeeds(seeds)
  const bright = (c: string): string => mix(c, '#ffffff', 0.25)
  return {
    background: s.well,
    foreground: s.text,
    cursor: s.accent,
    cursorAccent: s.well,
    selectionBackground: hexAlpha(s.accent, 0.33),
    black: s.surface,
    red: s.danger,
    green: s.ok,
    yellow: s.warn,
    blue: s.accent,
    magenta: s.keyword,
    cyan: s.type,
    white: s.text,
    brightBlack: s.muted,
    brightRed: bright(s.danger),
    brightGreen: bright(s.ok),
    brightYellow: bright(s.warn),
    brightBlue: bright(s.accent),
    brightMagenta: bright(s.keyword),
    brightCyan: bright(s.type),
    brightWhite: '#ffffff'
  }
}

/** The JSON schema Claude answers in: a name and the 17 seeds, nothing else */
export const THEME_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'A short name for the theme, at most 3 words' },
    ...Object.fromEntries(THEME_SEEDS.map((s) => [s.key, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: `${s.label}: ${s.hint}` }]))
  },
  required: ['name', ...THEME_SEEDS.map((s) => s.key)],
  additionalProperties: false
}
