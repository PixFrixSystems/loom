import type { ReactNode } from 'react'

// Icons for files and folders by type, drawn here so they share one hand: line glyphs in the colour
// each kind of file is known by, and a filled tag with letters for languages. The colours are muted
// to about the same lightness, so a list of them stays calm on the dark panes.

type Glyph =
  | 'doc'
  | 'lines'
  | 'code'
  | 'braces'
  | 'hash'
  | 'markdown'
  | 'terminal'
  | 'image'
  | 'vector'
  | 'atom'
  | 'python'
  | 'branch'
  | 'lock'
  | 'key'
  | 'sliders'
  | 'package'
  | 'archive'
  | 'audio'
  | 'video'
  | 'database'
  | 'table'
  | 'font'
  | 'ribbon'
  | 'boxes'
  | 'window'
  | 'vue'
  | 'tag'

interface Look {
  glyph: Glyph
  color: string
  /** Letters on a tag */
  text?: string
}

const C = {
  yellow: '#e3c65f',
  blue: '#6aa4e8',
  cyan: '#67c7dc',
  orange: '#e8895c',
  amber: '#d9a85c',
  red: '#e2727a',
  pink: '#d683b4',
  green: '#66c48f',
  teal: '#5bbfae',
  purple: '#ae8ff0',
  rose: '#d97f8f',
  grey: '#a2a8b8',
  lavender: '#c8c6fa',
  folder: '#7fa2da'
}

const tag = (text: string, color: string): Look => ({ glyph: 'tag', text, color })
const look = (glyph: Glyph, color: string): Look => ({ glyph, color })

const BY_EXT: Record<string, Look> = {
  html: look('code', C.orange),
  htm: look('code', C.orange),
  xml: look('code', C.amber),
  plist: look('code', C.amber),
  css: look('hash', C.blue),
  scss: look('hash', C.pink),
  sass: look('hash', C.pink),
  less: look('hash', C.blue),
  js: tag('JS', C.yellow),
  mjs: tag('JS', C.yellow),
  cjs: tag('JS', C.yellow),
  ts: tag('TS', C.blue),
  mts: tag('TS', C.blue),
  cts: tag('TS', C.blue),
  jsx: look('atom', C.cyan),
  tsx: look('atom', C.cyan),
  json: look('braces', C.yellow),
  jsonc: look('braces', C.yellow),
  json5: look('braces', C.yellow),
  md: look('markdown', C.blue),
  mdx: look('markdown', C.blue),
  txt: look('lines', C.grey),
  log: look('lines', C.grey),
  py: look('python', C.blue),
  pyw: look('python', C.blue),
  ipynb: look('python', C.orange),
  bat: look('terminal', C.purple),
  cmd: look('terminal', C.purple),
  sh: look('terminal', C.green),
  bash: look('terminal', C.green),
  zsh: look('terminal', C.green),
  ps1: look('terminal', C.blue),
  psm1: look('terminal', C.blue),
  png: look('image', C.teal),
  jpg: look('image', C.teal),
  jpeg: look('image', C.teal),
  gif: look('image', C.teal),
  webp: look('image', C.teal),
  avif: look('image', C.teal),
  bmp: look('image', C.teal),
  ico: look('image', C.teal),
  svg: look('vector', C.amber),
  yml: look('sliders', C.rose),
  yaml: look('sliders', C.rose),
  toml: look('sliders', C.grey),
  ini: look('sliders', C.grey),
  cfg: look('sliders', C.grey),
  conf: look('sliders', C.grey),
  properties: look('sliders', C.grey),
  editorconfig: look('sliders', C.grey),
  npmrc: look('sliders', C.red),
  nvmrc: look('sliders', C.green),
  prettierrc: look('sliders', C.grey),
  eslintrc: look('sliders', C.purple),
  browserslistrc: look('sliders', C.amber),
  gitignore: look('branch', C.orange),
  gitattributes: look('branch', C.orange),
  gitmodules: look('branch', C.orange),
  gitkeep: look('branch', C.orange),
  lock: look('lock', C.grey),
  lockb: look('lock', C.grey),
  zip: look('archive', C.amber),
  '7z': look('archive', C.amber),
  rar: look('archive', C.amber),
  tar: look('archive', C.amber),
  gz: look('archive', C.amber),
  tgz: look('archive', C.amber),
  mp3: look('audio', C.pink),
  wav: look('audio', C.pink),
  ogg: look('audio', C.pink),
  flac: look('audio', C.pink),
  m4a: look('audio', C.pink),
  mp4: look('video', C.rose),
  mov: look('video', C.rose),
  webm: look('video', C.rose),
  mkv: look('video', C.rose),
  avi: look('video', C.rose),
  sql: look('database', C.amber),
  db: look('database', C.amber),
  sqlite: look('database', C.amber),
  sqlite3: look('database', C.amber),
  prisma: look('database', C.teal),
  csv: look('table', C.green),
  tsv: look('table', C.green),
  xlsx: look('table', C.green),
  xls: look('table', C.green),
  pdf: look('doc', C.red),
  woff: look('font', C.grey),
  woff2: look('font', C.grey),
  ttf: look('font', C.grey),
  otf: look('font', C.grey),
  exe: look('window', C.grey),
  dll: look('window', C.grey),
  msi: look('window', C.grey),
  vue: look('vue', C.green),
  svelte: tag('S', C.orange),
  astro: tag('A', C.orange),
  go: tag('GO', C.cyan),
  rs: tag('RS', C.orange),
  java: tag('JV', C.orange),
  kt: tag('KT', C.purple),
  c: tag('C', C.blue),
  h: tag('H', C.purple),
  cpp: tag('C+', C.blue),
  hpp: tag('H+', C.purple),
  cs: tag('C#', C.purple),
  rb: tag('RB', C.red),
  php: tag('PHP', C.purple),
  swift: tag('SW', C.orange),
  dart: tag('DT', C.cyan),
  lua: tag('LU', C.blue),
  r: tag('R', C.blue),
  map: look('doc', C.grey)
}

const BY_NAME: Record<string, Look> = {
  'package.json': look('package', C.red),
  'package-lock.json': look('lock', C.grey),
  'pnpm-lock.yaml': look('lock', C.grey),
  'yarn.lock': look('lock', C.grey),
  'bun.lockb': look('lock', C.grey),
  'claude.md': look('markdown', C.lavender),
  'claude.local.md': look('markdown', C.lavender),
  'agents.md': look('markdown', C.lavender),
  dockerfile: look('boxes', C.blue),
  '.dockerignore': look('boxes', C.blue),
  makefile: look('terminal', C.grey)
}

/** Folders that are generated or kept by tools: dimmed, so the project's own folders stand out. */
const QUIET_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.wrangler', '.vercel', '.svelte-kit', '.output'])

function lookFor(name: string): Look {
  const n = name.toLowerCase()
  if (BY_NAME[n]) return BY_NAME[n]
  if (n === '.env' || n.startsWith('.env.')) return look('key', C.yellow)
  if (/^(license|licence|copying)(\.|$)/.test(n)) return look('ribbon', C.amber)
  if (n.startsWith('dockerfile') || /^(docker-)?compose(\.[\w-]+)*\.ya?ml$/.test(n)) return look('boxes', C.blue)
  const dot = n.lastIndexOf('.')
  const ext = dot >= 0 ? n.slice(dot + 1) : ''
  return BY_EXT[ext] ?? { glyph: 'doc', color: 'currentColor' }
}

function shapes(l: Look): ReactNode {
  const fill = { fill: l.color, stroke: 'none' }
  switch (l.glyph) {
    case 'doc':
      return <path d="M4 1.75h5.25L12.5 5v8.25a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1zM9.25 1.75V5h3.25" />
    case 'lines':
      return <path d="M4 1.75h5.25L12.5 5v8.25a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1zM9.25 1.75V5h3.25M5.5 8h5M5.5 10.75h5" />
    case 'code':
      return <path d="M5 4.5 1.75 8 5 11.5M11 4.5 14.25 8 11 11.5M9.25 3 6.75 13" />
    case 'braces':
      return (
        <>
          <path d="M5.5 2.5C4 2.5 3.5 3.2 3.5 4.3v1.9C3.5 7.3 3 8 2 8c1 0 1.5.7 1.5 1.8v1.9c0 1.1.5 1.8 2 1.8M10.5 2.5c1.5 0 2 .7 2 1.8v1.9c0 1.1.5 1.8 1.5 1.8-1 0-1.5.7-1.5 1.8v1.9c0 1.1-.5 1.8-2 1.8" />
          <circle cx="6.6" cy="9.6" r=".85" {...fill} />
          <circle cx="9.4" cy="9.6" r=".85" {...fill} />
        </>
      )
    case 'hash':
      return <path d="M6.25 2.5 5 13.5M11 2.5 9.75 13.5M2.75 6h11M2.25 10h11" />
    case 'markdown':
      return (
        <>
          <rect x="1" y="3.25" width="14" height="9.5" rx="2" />
          <path d="M3.75 10.25v-4.5l2 2.5 2-2.5v4.5M11.5 5.75v4.5M9.75 8.75l1.75 1.75 1.75-1.75" />
        </>
      )
    case 'terminal':
      return (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <path d="m4.5 6 2 2-2 2M8.25 10.25h3.25" />
        </>
      )
    case 'image':
      return (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <circle cx="5.5" cy="6.25" r="1.25" {...fill} />
          <path d="m2 12.25 3.75-3.75 3 3 2-2 3.5 3.25" />
        </>
      )
    case 'vector':
      return (
        <>
          <path d="M3 12.5C4.25 7 7.75 4 13 3.25" />
          <rect x="1.25" y="11" width="3.25" height="3.25" rx=".6" {...fill} />
          <rect x="11.5" y="1.75" width="3.25" height="3.25" rx=".6" {...fill} />
        </>
      )
    case 'atom':
      return (
        <>
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(120 8 8)" />
          <circle cx="8" cy="8" r="1.25" {...fill} />
        </>
      )
    case 'python':
      return (
        <>
          <path d="M8 1.5H5.75A2.25 2.25 0 0 0 3.5 3.75V6.5h5v1H3.25A1.75 1.75 0 0 0 1.5 9.25v1.5a1.75 1.75 0 0 0 1.75 1.75H4.5V9.75A1.75 1.75 0 0 1 6.25 8h3.5A1.75 1.75 0 0 0 11.5 6.25v-2.5A2.25 2.25 0 0 0 9.25 1.5z" {...fill} />
          <path d="M8 14.5h2.25a2.25 2.25 0 0 0 2.25-2.25V9.5h-5v-1h5.25a1.75 1.75 0 0 0 1.75-1.75v-1.5A1.75 1.75 0 0 0 12.75 3.5H11.5v2.75A1.75 1.75 0 0 1 9.75 8h-3.5A1.75 1.75 0 0 0 4.5 9.75v2.5a2.25 2.25 0 0 0 2.25 2.25z" fill={C.yellow} stroke="none" />
          <circle cx="6" cy="3.75" r=".7" fill="#10131c" stroke="none" />
          <circle cx="10" cy="12.25" r=".7" fill="#10131c" stroke="none" />
        </>
      )
    case 'branch':
      return (
        <>
          <circle cx="4.5" cy="3.5" r="1.6" />
          <circle cx="4.5" cy="12.5" r="1.6" />
          <circle cx="11.5" cy="5" r="1.6" />
          <path d="M4.5 5.1v5.8M11.5 6.6v.4a3 3 0 0 1-3 3h-1a3 3 0 0 0-3 .9" />
        </>
      )
    case 'lock':
      return (
        <>
          <rect x="3" y="7" width="10" height="7" rx="1.5" {...fill} />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </>
      )
    case 'key':
      return (
        <>
          <circle cx="5" cy="8" r="2.75" />
          <path d="M7.75 8h6.5M12.25 8v2.5M14.25 8v2" />
        </>
      )
    case 'sliders':
      return (
        <>
          <path d="M2 5h12M2 11h12" />
          <circle cx="6" cy="5" r="1.9" {...fill} />
          <circle cx="10.5" cy="11" r="1.9" {...fill} />
        </>
      )
    case 'package':
      return <path d="M8 1.75 14 4.75v6.5L8 14.25 2 11.25v-6.5zM2 4.75l6 3 6-3M8 7.75v6.5" />
    case 'archive':
      return (
        <>
          <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" />
          <path d="M8 1.5v1.5M8 4.5V6M8 7.5V9" />
          <rect x="6.5" y="9.75" width="3" height="2.75" rx=".6" {...fill} />
        </>
      )
    case 'audio':
      return (
        <>
          <path d="M6 12.5V3.75l7-1.5v8.75" />
          <circle cx="4.25" cy="12.5" r="1.9" {...fill} />
          <circle cx="11.25" cy="11" r="1.9" {...fill} />
        </>
      )
    case 'video':
      return (
        <>
          <rect x="1.5" y="3" width="13" height="10" rx="2" />
          <path d="M6.5 5.75v4.5L10.25 8z" {...fill} />
        </>
      )
    case 'database':
      return (
        <>
          <ellipse cx="8" cy="3.75" rx="5.5" ry="2" />
          <path d="M2.5 3.75v8.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-8.5M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
        </>
      )
    case 'table':
      return (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <path d="M1.5 6.25h13M1.5 9.75h13M6 2.5v11" />
        </>
      )
    case 'font':
      return <path d="M3 13.5 8 2.5l5 11M5 9.5h6" />
    case 'ribbon':
      return (
        <>
          <circle cx="8" cy="6" r="4" />
          <path d="M5.5 9.25 4.5 14l3.5-1.75L11.5 14l-1-4.75" />
        </>
      )
    case 'boxes':
      return (
        <>
          <path d="M1.75 8.25h12.5v2a3.25 3.25 0 0 1-3.25 3.25H5a3.25 3.25 0 0 1-3.25-3.25z" />
          <rect x="3" y="5" width="2.5" height="2.25" rx=".4" {...fill} />
          <rect x="6.25" y="5" width="2.5" height="2.25" rx=".4" {...fill} />
          <rect x="9.5" y="5" width="2.5" height="2.25" rx=".4" {...fill} />
          <rect x="6.25" y="2" width="2.5" height="2.25" rx=".4" {...fill} />
        </>
      )
    case 'window':
      return (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <path d="M1.5 5.75h13" />
        </>
      )
    case 'vue':
      return <path d="M1.25 2.5h3.1L8 8.9l3.65-6.4h3.1L8 14z" {...fill} />
    case 'tag':
      return (
        <>
          <rect x="1" y="2" width="14" height="12" rx="2.5" {...fill} />
          <text x="8" y={(l.text?.length ?? 0) > 2 ? 10.3 : 10.9} textAnchor="middle" fill="#10131c" stroke="none" fontSize={(l.text?.length ?? 0) > 2 ? 6 : 7.8}>
            {l.text}
          </text>
        </>
      )
  }
}

/** The icon for a file or a folder, by its name. Folders show open while they are. */
export function FileIcon({ name, dir = false, open = false }: { name: string; dir?: boolean; open?: boolean }): ReactNode {
  if (dir) {
    const n = name.toLowerCase()
    const color = n === '.claude' ? C.lavender : C.folder
    return (
      <svg className={`file-icon${QUIET_DIRS.has(n) ? ' quiet' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
        {open ? (
          <>
            <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.4L8 4.6h4.5A1.5 1.5 0 0 1 14 6.1V7H4.6a1.5 1.5 0 0 0-1.4 1L1.5 12.6z" fill={color} opacity=".55" />
            <path d="M3.4 8.05A1.2 1.2 0 0 1 4.5 7.25h9.9a.8.8 0 0 1 .75 1.06l-1.55 4.4a1.2 1.2 0 0 1-1.13.79H2.25a.6.6 0 0 1-.56-.8z" fill={color} />
          </>
        ) : (
          <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.4L8 4.6h5A1.5 1.5 0 0 1 14.5 6.1v5.9a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12z" fill={color} />
        )}
      </svg>
    )
  }
  const l = lookFor(name)
  return (
    <svg
      className={`file-icon${l.color === 'currentColor' ? ' plain' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke={l.color}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes(l)}
    </svg>
  )
}
