import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { customEditor } from '@shared/customTheme'
import type { ThemeName } from '@shared/types'
import { useStore } from '../store'
import { lookKey, lookOf, type Look } from './theme'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

// Files open one at a time, outside any build, so import errors would be noise. Keep syntax checks only.
const tsDiag = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true }
monaco.typescript.typescriptDefaults.setDiagnosticsOptions(tsDiag)
monaco.typescript.javascriptDefaults.setDiagnosticsOptions(tsDiag)
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore' })

// The brand's code colours: keywords and tags blue, properties teal, strings amber, types and
// variables orchid, numbers rose, comments a quiet grey, on the pane's own ground.
const LOOM: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d8e4' },
    { token: 'comment', foreground: '5f667a', fontStyle: 'italic' },
    { token: 'keyword', foreground: '9fb0ff' },
    { token: 'tag', foreground: '9fb0ff' },
    { token: 'string', foreground: 'f0c38a' },
    { token: 'number', foreground: 'f0a3ab' },
    { token: 'regexp', foreground: 'f0a3ab' },
    { token: 'type', foreground: 'e2a6ff' },
    { token: 'variable', foreground: 'e2a6ff' },
    { token: 'attribute.name', foreground: '8fd3c4' },
    { token: 'attribute.value', foreground: 'f0c38a' },
    { token: 'key', foreground: '8fd3c4' },
    { token: 'string.key.json', foreground: '8fd3c4' },
    { token: 'delimiter', foreground: 'a9afbf' }
  ],
  colors: {
    'editor.background': '#10131c',
    'editor.foreground': '#d4d8e4',
    'editorLineNumber.foreground': '#4f5568',
    'editorLineNumber.activeForeground': '#a9afbf',
    'editor.lineHighlightBackground': '#ffffff08',
    'editor.selectionBackground': '#4b47b8a0',
    'editor.inactiveSelectionBackground': '#4b47b85c',
    'editorCursor.foreground': '#c8c6fa',
    'editorWhitespace.foreground': '#ffffff1f',
    'editorIndentGuide.background1': '#ffffff12',
    'editorIndentGuide.activeBackground1': '#ffffff26',
    'editorWidget.background': '#161926',
    'editorWidget.border': '#ffffff1f',
    'editorSuggestWidget.background': '#161926',
    'editorSuggestWidget.border': '#ffffff1f',
    'editorSuggestWidget.selectedBackground': '#ffffff12',
    'input.background': '#191c26',
    'input.border': '#ffffff1f',
    'focusBorder': '#c8c6fa',
    'scrollbarSlider.background': '#ffffff29',
    'scrollbarSlider.hoverBackground': '#ffffff47',
    'scrollbarSlider.activeBackground': '#ffffff5c',
    'minimap.background': '#10131c',
    'diffEditor.insertedTextBackground': '#4fd18b33',
    'diffEditor.removedTextBackground': '#ff5b7033',
    'diffEditor.insertedLineBackground': '#4fd18b1f',
    'diffEditor.removedLineBackground': '#ff5b701f',
    'diffEditor.diagonalFill': '#ffffff12',
    'diffEditor.unchangedRegionBackground': '#080a10',
    'diffEditor.unchangedRegionForeground': '#858b9c'
  }
}

// One Dark, from One Dark Pro for VS Code (MIT, Binaryify): keywords purple, strings green,
// functions blue, types yellow, variables, tags and keys red, numbers and attributes orange.
// The focus ring is the cursor blue, where One Dark's own grey would be hard to see.
const ONE_DARK: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'abb2bf' },
    { token: 'comment', foreground: '7f848e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'tag', foreground: 'e06c75' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'regexp', foreground: '56b6c2' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'variable', foreground: 'e06c75' },
    { token: 'attribute.name', foreground: 'd19a66' },
    { token: 'attribute.value', foreground: '98c379' },
    { token: 'key', foreground: 'e06c75' },
    { token: 'string.key.json', foreground: 'e06c75' },
    { token: 'delimiter', foreground: 'abb2bf' }
  ],
  colors: {
    'editor.background': '#282c34',
    'editor.foreground': '#abb2bf',
    'editorLineNumber.foreground': '#495162',
    'editorLineNumber.activeForeground': '#abb2bf',
    'editor.lineHighlightBackground': '#2c313c',
    'editor.selectionBackground': '#67769660',
    'editor.inactiveSelectionBackground': '#67769630',
    'editorCursor.foreground': '#528bff',
    'editorWhitespace.foreground': '#ffffff1d',
    'editorIndentGuide.background1': '#3b4048',
    'editorIndentGuide.activeBackground1': '#c8c8c859',
    'editorWidget.background': '#21252b',
    'editorWidget.border': '#181a1f',
    'editorSuggestWidget.background': '#21252b',
    'editorSuggestWidget.border': '#181a1f',
    'editorSuggestWidget.selectedBackground': '#2c313a',
    'input.background': '#1d1f23',
    'input.border': '#181a1f',
    'focusBorder': '#528bff',
    'scrollbarSlider.background': '#4e566660',
    'scrollbarSlider.hoverBackground': '#5a637580',
    'scrollbarSlider.activeBackground': '#747d9180',
    'minimap.background': '#282c34',
    'diffEditor.insertedTextBackground': '#98c37933',
    'diffEditor.removedTextBackground': '#e06c7533',
    'diffEditor.insertedLineBackground': '#98c3791f',
    'diffEditor.removedLineBackground': '#e06c751f',
    'diffEditor.diagonalFill': '#ffffff12',
    'diffEditor.unchangedRegionBackground': '#21252b',
    'diffEditor.unchangedRegionForeground': '#959ca8'
  }
}

// The four below take their colours from each theme's VS Code file and set only what differs from
// vs-dark; scroll bars and diff colours are vs-dark's own. The focus ring is the theme's meaning
// colour wherever the original's is too faint to see.

// Dracula, from Dracula Theme for VS Code (MIT)
const DRACULA: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'f8f8f2' },
    { token: 'comment', foreground: '6272a4' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'tag', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'regexp', foreground: 'f1fa8c' },
    { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'attribute.name', foreground: '50fa7b', fontStyle: 'italic' },
    { token: 'attribute.value', foreground: 'f1fa8c' },
    { token: 'key', foreground: '8be9fd' },
    { token: 'string.key.json', foreground: '8be9fd' },
    { token: 'delimiter', foreground: 'f8f8f2' }
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#6272a4',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.lineHighlightBackground': '#44475a75',
    'editor.selectionBackground': '#44475a',
    'editor.inactiveSelectionBackground': '#44475a75',
    'editorCursor.foreground': '#f8f8f2',
    'editorWhitespace.foreground': '#ffffff1a',
    'editorIndentGuide.background1': '#ffffff1a',
    'editorIndentGuide.activeBackground1': '#ffffff45',
    'editorWidget.background': '#21222c',
    'editorWidget.border': '#191a21',
    'editorSuggestWidget.background': '#21222c',
    'editorSuggestWidget.border': '#191a21',
    'editorSuggestWidget.selectedBackground': '#44475a',
    'input.background': '#282a36',
    'input.border': '#191a21',
    'focusBorder': '#bd93f9',
    'minimap.background': '#282a36',
    'diffEditor.unchangedRegionBackground': '#21222c',
    'diffEditor.unchangedRegionForeground': '#96a1c2'
  }
}

// GitHub Dark, from GitHub Theme for VS Code, Dark Default (MIT)
const GITHUB_DARK: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'e6edf3' },
    { token: 'comment', foreground: '8b949e' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'tag', foreground: '7ee787' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'regexp', foreground: 'a5d6ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'variable', foreground: 'ffa657' },
    { token: 'attribute.name', foreground: '79c0ff' },
    { token: 'attribute.value', foreground: 'a5d6ff' },
    { token: 'key', foreground: '7ee787' },
    { token: 'string.key.json', foreground: '7ee787' },
    { token: 'delimiter', foreground: 'e6edf3' }
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editorLineNumber.foreground': '#6e7681',
    'editorLineNumber.activeForeground': '#e6edf3',
    'editor.lineHighlightBackground': '#6e76811a',
    'editor.selectionBackground': '#264f78',
    'editor.inactiveSelectionBackground': '#264f7880',
    'editorCursor.foreground': '#2f81f7',
    'editorWhitespace.foreground': '#484f58',
    'editorIndentGuide.background1': '#e6edf31f',
    'editorIndentGuide.activeBackground1': '#e6edf33d',
    'editorWidget.background': '#161b22',
    'editorWidget.border': '#30363d',
    'editorSuggestWidget.background': '#161b22',
    'editorSuggestWidget.border': '#30363d',
    'editorSuggestWidget.selectedBackground': '#6e768166',
    'input.background': '#0d1117',
    'input.border': '#30363d',
    'focusBorder': '#1f6feb',
    'minimap.background': '#0d1117',
    'diffEditor.unchangedRegionBackground': '#010409',
    'diffEditor.unchangedRegionForeground': '#7d8590'
  }
}

// Nord, from Nord for VS Code (MIT)
const NORD: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd8dee9' },
    { token: 'comment', foreground: '616e88' },
    { token: 'keyword', foreground: '81a1c1' },
    { token: 'tag', foreground: '81a1c1' },
    { token: 'string', foreground: 'a3be8c' },
    { token: 'number', foreground: 'b48ead' },
    { token: 'regexp', foreground: 'ebcb8b' },
    { token: 'type', foreground: '8fbcbb' },
    { token: 'variable', foreground: 'd8dee9' },
    { token: 'attribute.name', foreground: '8fbcbb' },
    { token: 'attribute.value', foreground: 'a3be8c' },
    { token: 'key', foreground: '8fbcbb' },
    { token: 'string.key.json', foreground: '8fbcbb' },
    { token: 'delimiter', foreground: 'eceff4' }
  ],
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'editorLineNumber.foreground': '#4c566a',
    'editorLineNumber.activeForeground': '#d8dee9',
    'editor.lineHighlightBackground': '#3b4252',
    'editor.selectionBackground': '#434c5ecc',
    'editor.inactiveSelectionBackground': '#434c5ecc',
    'editorCursor.foreground': '#d8dee9',
    'editorWhitespace.foreground': '#4c566ab3',
    'editorIndentGuide.background1': '#434c5eb3',
    'editorIndentGuide.activeBackground1': '#4c566a',
    'editorWidget.background': '#2e3440',
    'editorWidget.border': '#3b4252',
    'editorSuggestWidget.background': '#2e3440',
    'editorSuggestWidget.border': '#3b4252',
    'editorSuggestWidget.selectedBackground': '#434c5e',
    'input.background': '#3b4252',
    'input.border': '#3b4252',
    'focusBorder': '#88c0d0',
    'minimap.background': '#2e3440',
    'diffEditor.unchangedRegionBackground': '#3b4252',
    'diffEditor.unchangedRegionForeground': '#a7aebc'
  }
}

// Monokai, from VS Code's built-in Monokai (MIT)
const MONOKAI: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'f8f8f2' },
    { token: 'comment', foreground: '88846f' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'tag', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'regexp', foreground: 'e6db74' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'attribute.name', foreground: 'a6e22e' },
    { token: 'attribute.value', foreground: 'e6db74' },
    { token: 'key', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'string.key.json', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'delimiter', foreground: 'f8f8f2' }
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#90908a',
    'editorLineNumber.activeForeground': '#c2c2bf',
    'editor.lineHighlightBackground': '#3e3d32',
    'editor.selectionBackground': '#878b9180',
    'editor.inactiveSelectionBackground': '#878b9140',
    'editorCursor.foreground': '#f8f8f0',
    'editorWhitespace.foreground': '#464741',
    'editorIndentGuide.background1': '#464741',
    'editorIndentGuide.activeBackground1': '#767771',
    'editorWidget.background': '#1e1f1c',
    'editorWidget.border': '#414339',
    'editorSuggestWidget.background': '#272822',
    'editorSuggestWidget.border': '#75715e',
    'editorSuggestWidget.selectedBackground': '#414339',
    'input.background': '#414339',
    'input.border': '#75715e',
    'focusBorder': '#66d9ef',
    'minimap.background': '#272822',
    'diffEditor.unchangedRegionBackground': '#1e1f1c',
    'diffEditor.unchangedRegionForeground': '#b0aea0'
  }
}

// Each Loom theme has the editor theme of the same name. A theme added to THEMES without one here is a
// type error, not an editor that silently stays in the old colours.
const EDITOR_THEMES: Record<ThemeName, monaco.editor.IStandaloneThemeData> = {
  loom: LOOM,
  'one-dark': ONE_DARK,
  dracula: DRACULA,
  'github-dark': GITHUB_DARK,
  nord: NORD,
  monokai: MONOKAI
}
for (const [name, theme] of Object.entries(EDITOR_THEMES)) monaco.editor.defineTheme(name, theme)

// The user's own themes (and one being previewed) are built from their seeds when the look changes.
// Monaco keeps a theme by name, so two names take turns: new colours go in under the one not showing.
let customName = 'custom-b'
function editorThemeFor(look: Look): string {
  if (!look.seeds) return look.theme
  customName = customName === 'custom-a' ? 'custom-b' : 'custom-a'
  const { colors, tokens } = customEditor(look.seeds)
  monaco.editor.defineTheme(customName, {
    base: 'vs-dark',
    inherit: true,
    colors,
    rules: Object.entries(tokens).map(([token, colour]) => ({ token, foreground: colour.slice(1) }))
  })
  return customName
}

let shown = editorThemeFor(lookOf(useStore.getState()))
let shownKey = lookKey(useStore.getState())

/** The editor theme on screen now, for editors as they open */
export const editorTheme = (): string => shown

// Monaco has one theme for the whole page, so every open editor follows the look from here.
useStore.subscribe((s) => {
  const next = lookKey(s)
  if (next === shownKey) return
  shownKey = next
  shown = editorThemeFor(JSON.parse(next) as Look)
  monaco.editor.setTheme(shown)
})

export { monaco }
