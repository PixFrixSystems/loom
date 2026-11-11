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

function makeComponents(cwd: string): Components {
  return {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href && /^https?:/i.test(href)) void window.loom.openExternal(href)
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
            title="Open in a tab"
            onClick={() => useStore.getState().openFile(resolvePath(text.trim(), cwd))}
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

export const Markdown = memo(function Markdown({ text, cwd }: { text: string; cwd: string }): ReactNode {
  return (
    <div className="md selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={makeComponents(cwd)}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
