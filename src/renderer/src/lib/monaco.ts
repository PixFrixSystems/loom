import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

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
monaco.editor.defineTheme('loom', {
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
})

export { monaco }
