import { customTokens, readCustomThemes, readSeeds } from '@shared/customTheme'
import { THEMES, type ThemeName, type ThemeSeeds } from '@shared/types'
import { useStore } from '../store'

type State = ReturnType<typeof useStore.getState>

/**
 * What the window shows: a built-in theme by name, or 'custom' with the seeds of the user's own
 * theme (or of one being previewed in Settings). tokens.css styles the built-ins; a custom look is
 * written into a style element below, the editor and terminals build theirs from the same seeds.
 */
export interface Look {
  theme: ThemeName | 'custom'
  seeds: ThemeSeeds | null
}

export function lookOf(s: State): Look {
  const preview = s.themePreview && readSeeds(s.themePreview.colours)
  if (preview) return { theme: 'custom', seeds: preview }
  const own = readCustomThemes(s.settings.customThemes).find((t) => t.id === s.settings.theme)
  if (own) return { theme: 'custom', seeds: own.colours }
  const builtIn = THEMES.find((t) => t.value === s.settings.theme)
  return { theme: builtIn?.value ?? 'loom', seeds: null }
}

/** The look as one string, so React and store subscriptions see a change only when there is one */
export const lookKey = (s: State): string => JSON.stringify(lookOf(s))

let style: HTMLStyleElement | null = null

/** Puts a look on the page: data-theme on <html>, and the custom colours when it is one of the user's own */
function wear(look: Look): void {
  if (look.seeds) {
    style ??= document.head.appendChild(document.createElement('style'))
    // Only colours made by customTokens from checked '#rrggbb' seeds end up in this text.
    const lines = Object.entries(customTokens(look.seeds)).map(([name, value]) => `  ${name}: ${value};`)
    style.textContent = `:root[data-theme='custom'] {\n${lines.join('\n')}\n}`
  }
  document.documentElement.dataset.theme = look.theme
}

/**
 * The main process names the saved theme in the page's address, so a built-in one is worn before
 * the saved state loads. The user's own needs its colours from that state, so until then the page
 * stays transparent over the window's background, which the main process has already painted.
 */
export function startWearingThemes(): void {
  const named = new URLSearchParams(location.search).get('theme')
  if (THEMES.some((t) => t.value === named)) document.documentElement.dataset.theme = named!
  let key = ''
  let previewKey = 'null'
  useStore.subscribe((s) => {
    // Until the saved state is in, the address or the window's background covers.
    if (!s.ready) return
    const next = lookKey(s)
    if (next !== key) {
      key = next
      wear(JSON.parse(next) as Look)
    }
    // The window's own frame follows a preview too, and goes back when it ends.
    const preview = JSON.stringify(s.themePreview ? readSeeds(s.themePreview.colours) : null)
    if (preview !== previewKey) {
      previewKey = preview
      window.loom.previewFrame(JSON.parse(preview) as ThemeSeeds | null)
    }
  })
}
