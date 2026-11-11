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

monaco.editor.defineTheme('loom', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8f8a81', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c59bd6' },
    { token: 'string', foreground: 'a8c47f' },
    { token: 'number', foreground: 'd9a86c' },
    { token: 'type', foreground: '7fb5c8' },
    { token: 'tag', foreground: 'd88e7a' },
    { token: 'attribute.name', foreground: 'd6b257' },
    { token: 'key', foreground: '7fb5c8' },
    { token: 'string.key.json', foreground: '7fb5c8' },
    { token: 'delimiter', foreground: 'a8a49b' }
  ],
  colors: {
    'editor.background': '#1a1c20',
    'editor.foreground': '#e8e4dc',
    'editorLineNumber.foreground': '#5d5a54',
    'editorLineNumber.activeForeground': '#b4afa5',
    'editor.lineHighlightBackground': '#ffffff08',
    'editor.selectionBackground': '#6fb5a150',
    'editor.inactiveSelectionBackground': '#6fb5a128',
    'editorCursor.foreground': '#84c3b0',
    'editorWhitespace.foreground': '#3b3f47',
    'editorIndentGuide.background1': '#2a2d33',
    'editorIndentGuide.activeBackground1': '#3b3f47',
    'editorWidget.background': '#212328',
    'editorWidget.border': '#3b3f47',
    'editorSuggestWidget.background': '#212328',
    'editorSuggestWidget.border': '#3b3f47',
    'editorSuggestWidget.selectedBackground': '#2c3a36',
    'input.background': '#1e2025',
    'input.border': '#3b3f47',
    'focusBorder': '#6fb5a1',
    'scrollbarSlider.background': '#e8e2d621',
    'scrollbarSlider.hoverBackground': '#e8e2d642',
    'scrollbarSlider.activeBackground': '#e8e2d655',
    'minimap.background': '#1a1c20'
  }
})

export { monaco }
