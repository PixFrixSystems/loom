import { Check, Copy } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'

function CopyButton({ text }: { text: string }): ReactNode {
  const [done, setDone] = useState(false)
  return (
    <button
      className="icon-btn code-copy"
      title={done ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? <Check /> : <Copy />}
    </button>
  )
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

const PATHLIKE = /^(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}(?::\d+)?$/

function resolvePath(p: string, cwd: string): string {
  const clean = p.replace(/:\d+$/, '')
  if (/^[A-Za-z]:[\\/]/.test(clean)) return clean
  return `${cwd.replace(/[\\/]+$/, '')}\\${clean.replace(/^\.?[\\/]/, '').replace(/\//g, '\\')}`
}

/** A link's target that is a file in the project: a relative path, or a Windows one. */
function fileHref(href: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(href)) return true
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('//')
}

const openPath = (p: string, cwd: string): void => useStore.getState().openFile(resolvePath(decodeURI(p.split('#')[0]), cwd))

function makeComponents(cwd: string): Components {
  return {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (!href) return
          // Web links go to the browser; links to files open them in a tab.
          if (/^https?:/i.test(href)) void window.loom.openExternal(href)
          else if (fileHref(href)) openPath(href, cwd)
        }}
        title={href}
      >
        {children}
      </a>
    ),
    pre: ({ children }) => {
      const text = textOf(children)
      return (
        <div className="code-block">
          <CopyButton text={text.replace(/\n$/, '')} />
          <pre>{children}</pre>
        </div>
      )
    },
    code: ({ className, children }) => {
      const text = textOf(children)
      if (!className && PATHLIKE.test(text.trim())) {
        return (
          <code
            className="path-link"
            role="link"
            tabIndex={0}
            title="Open in a tab"
            onClick={() => useStore.getState().openFile(resolvePath(text.trim(), cwd))}
            onKeyDown={(e) => e.key === 'Enter' && useStore.getState().openFile(resolvePath(text.trim(), cwd))}
          >
            {children}
          </code>
        )
      }
      return <code className={className}>{children}</code>
    },
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    )
  }
}

// Built once per folder: new components on every draw would make React rebuild every link,
// code block and table, losing selection and clicks while a reply streams in.
const componentCache = new Map<string, Components>()
function componentsFor(cwd: string): Components {
  let c = componentCache.get(cwd)
  if (!c) {
    c = makeComponents(cwd)
    componentCache.set(cwd, c)
  }
  return c
}

const REMARK = [remarkGfm]
const HIGHLIGHT = [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as const
const NONE: [] = []

/** `streaming`: a reply still being written, drawn without syntax colours until it's done. */
export const Markdown = memo(function Markdown({ text, cwd, streaming = false }: { text: string; cwd: string; streaming?: boolean }): ReactNode {
  return (
    <div className="md selectable">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={streaming ? NONE : (HIGHLIGHT as never)} components={componentsFor(cwd)}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
