import { ArrowUp, Cpu, Gauge, Paperclip, ShieldCheck, Square, Workflow, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_MODELS, type ChatTab, type ContextInfo, type EffortLevel, type ImageAttachment, type PermissionMode, type SlashCommandInfo } from '@shared/types'
import { EMPTY_CHAT, useStore } from '../store'
import { Dropdown } from './Menu'

export const MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'Ask before edits', description: 'Claude asks before changing files or running commands' },
  { value: 'acceptEdits', label: 'Edit automatically', description: 'File edits go ahead; other actions still ask' },
  { value: 'plan', label: 'Plan mode', description: 'Claude explores and proposes a plan, changing nothing' },
  { value: 'auto', label: 'Auto mode', description: 'A safety check approves routine actions and asks about the rest' },
  { value: 'bypassPermissions', label: 'Full access', description: 'Never asks. Only for folders you trust' }
]

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}
const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

const BUILTIN_COMMANDS: SlashCommandInfo[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context' },
  { name: 'clear', description: 'Start the conversation over' },
  { name: 'context', description: 'Show how much context is used' },
  { name: 'cost', description: 'Show what this chat has used' },
  { name: 'init', description: 'Create a CLAUDE.md for this project' },
  { name: 'review', description: 'Review the current changes' }
]

/** Claude takes images of these types, each up to 5 MB, a few per message. */
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_IMAGES = 8
const SENDABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
/** Longest side a converted image keeps; Claude scales larger ones down anyway. */
const MAX_SIDE = 2000

/** Where a skill comes from, in words: Claude Code says "user", "project" or names the plugin. */
function sourceLabel(source: string): string {
  if (source === 'user') return 'your skill'
  if (source === 'project') return 'this project'
  if (source.startsWith('plugin')) return 'plugin'
  return source
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  return `${Math.max(1, Math.round(n / 1000))}k`
}

/** How full the chat is. The tick marks where Claude starts summarizing earlier messages. */
function ContextMeter({ info }: { info?: ContextInfo }): ReactNode {
  if (!info?.max) return null
  const limit = info.max - info.buffer
  const pct = Math.min(100, Math.round((info.used / info.max) * 100))
  const lvl = info.used >= limit * 0.9 ? 'stop' : info.used >= limit * 0.7 ? 'warn' : 'ok'
  const title =
    `Context: ${tokens(info.used)} of ${tokens(info.max)} tokens${info.estimated ? ', from the saved chat' : ''}.\n` +
    `Claude summarizes earlier messages at ${tokens(limit)}, about ${tokens(Math.max(0, limit - info.used))} from now.`
  return (
    <span className="ctx-meter" title={title} role="img" aria-label={`Context ${pct}% full`}>
      <span className={`meter-bar lvl-${lvl}`}>
        <span className="meter-fill" style={{ width: `${(info.used / info.max) * 100}%` }} />
        <span className="meter-stop" style={{ left: `${(limit / info.max) * 100}%` }} />
      </span>
      <span className={`meter-pct lvl-${lvl}`}>{pct}%</span>
    </span>
  )
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * An image ready to send. Types Claude takes, under 5 MB, go as they are; anything else the browser
 * can draw (a big screenshot, a BMP or SVG) is redrawn smaller as PNG, or JPEG when PNG is too big.
 * Null, with the reason, when it can't be made to fit.
 */
async function readImage(file: File): Promise<{ image: ImageAttachment | null; problem?: string }> {
  const name = file.name || 'image'
  if (SENDABLE.has(file.type) && file.size <= MAX_IMAGE) {
    const url = await asDataUrl(file)
    return { image: { mediaType: file.type, data: url.slice(url.indexOf(',') + 1), name } }
  }
  const src = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = (type: string, q?: number): Promise<Blob | null> => new Promise((r) => canvas.toBlob(r, type, q))
    let out = await blob('image/png')
    if (!out || out.size > MAX_IMAGE) out = await blob('image/jpeg', 0.88)
    if (!out || out.size > MAX_IMAGE) return { image: null, problem: `${name} is too big to send, even made smaller.` }
    const url = await asDataUrl(out)
    return { image: { mediaType: out.type, data: url.slice(url.indexOf(',') + 1), name } }
  } catch {
    return { image: null, problem: `${name} couldn't be read as an image.` }
  } finally {
    URL.revokeObjectURL(src)
  }
}

export const Composer = memo(function Composer({ tab, focusKey }: { tab: ChatTab; focusKey: number }): ReactNode {
  const s = useStore.getState()
  const chat = useStore((st) => st.chats[tab.id]) ?? EMPTY_CHAT
  const knownModels = useStore((st) => st.knownModels)
  const settings = useStore((st) => st.settings)
  const defaultEffort = useStore((st) => st.info?.defaultEffort ?? null)
  const [text, setText] = useState(chat.draft || tab.draft || '')
  const images = chat.attachments
  const setImages = (fn: (cur: ImageAttachment[]) => ImageAttachment[]): void => useStore.getState().setAttachments(tab.id, fn(useStore.getState().chat(tab.id).attachments))
  const [cmdIndex, setCmdIndex] = useState(0)
  // Esc or a click elsewhere puts the / list away until the text changes.
  const [cmdDismissed, setCmdDismissed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const busy = chat.status === 'running' || chat.status === 'starting'
  const models = knownModels.length ? knownModels : DEFAULT_MODELS
  const modelValue = tab.model ?? ''
  const modeValue: PermissionMode | '' = tab.permissionMode ?? chat.permissionMode ?? settings.defaultPermissionMode ?? ''
  const modelInfo = models.find((m) => m.value === modelValue || (!!chat.activeModel && m.resolved === chat.activeModel))
  const efforts = modelInfo?.efforts ?? ALL_EFFORTS
  const effortValue: EffortLevel | '' = tab.effort ?? ''
  const effortOptions = [
    { value: '' as EffortLevel | '', label: defaultEffort ? `Default (${EFFORT_LABELS[defaultEffort]})` : 'Default', description: 'What your Claude settings use' },
    ...efforts.map((e) => ({ value: e as EffortLevel | '', label: EFFORT_LABELS[e] }))
  ]
  const modelLabel = models.find((m) => m.value === modelValue)?.label ?? (modelValue || 'Default')
  const modeLabel = MODE_OPTIONS.find((m) => m.value === modeValue)?.label ?? 'Claude default mode'
  const effortLabel = effortValue ? EFFORT_LABELS[effortValue] : defaultEffort ? EFFORT_LABELS[defaultEffort] : 'Default'

  useEffect(() => {
    ta.current?.focus({ preventScroll: true })
  }, [focusKey])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`
  }, [text])

  useEffect(() => {
    const t = setTimeout(() => s.setDraft(tab.id, text), 300)
    return () => clearTimeout(t)
  }, [text, tab.id])

  useEffect(() => setCmdDismissed(false), [text])

  const query = text.match(/^\/(\S*)$/)?.[1] ?? null
  const commands = useMemo(() => {
    if (query === null || cmdDismissed) return []
    const list = chat.commands.length ? chat.commands : BUILTIN_COMMANDS
    const q = query.toLowerCase()
    // Everything that matches, names starting with what you typed first.
    return list
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
  }, [query, cmdDismissed, chat.commands])
  const cmdList = useRef<HTMLDivElement>(null)

  useEffect(() => setCmdIndex(0), [query, commands.length])
  useEffect(() => {
    cmdList.current?.querySelector('.cmd.active')?.scrollIntoView({ block: 'nearest' })
  }, [cmdIndex])
  // A chat that hasn't started yet still offers all your skills: ask for them when you type /.
  useEffect(() => {
    if (text.startsWith('/') && !chat.commands.length) void s.loadCommands(tab.id)
  }, [text.startsWith('/'), chat.commands.length])

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = [...files]
    const results = await Promise.all(list.filter((f) => f.type.startsWith('image/')).map(readImage))
    const problems = results.map((r) => r.problem).filter((p): p is string => !!p)
    const imgs = results.map((r) => r.image).filter((i): i is ImageAttachment => !!i)
    if (imgs.length) {
      const room = MAX_IMAGES - useStore.getState().chat(tab.id).attachments.length
      if (imgs.length > room) problems.push(`A message takes up to ${MAX_IMAGES} images, so ${imgs.length - Math.max(0, room)} were left out.`)
      setImages((cur) => [...cur, ...imgs].slice(0, MAX_IMAGES))
    }
    for (const p of problems) useStore.getState().showToast(p)
    const others = list.filter((f) => !f.type.startsWith('image/'))
    if (others.length) {
      const paths = others.map((f) => window.loom.pathForFile(f)).filter(Boolean)
      if (paths.length) setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${paths.map((p) => `@${p}`).join(' ')} `)
    }
  }

  const submit = (): void => {
    if ((!text.trim() && !images.length) || chat.moving) return
    void s.send(tab.id, text, images)
    setText('')
    s.setAttachments(tab.id, [])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (commands.length) {
      if (e.key === 'Escape') {
        // Put the list away; Esc again stops Claude.
        e.preventDefault()
        setCmdDismissed(true)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : commands.length - 1)) % commands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && text !== `/${commands[cmdIndex].name}`)) {
        e.preventDefault()
        setText(`/${commands[cmdIndex].name} `)
        return
      }
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      s.interrupt(tab.id)
      return
    }
    if (e.key === 'Enter') {
      const wantsSend = settings.sendWithCtrlEnter ? e.ctrlKey : !e.shiftKey && !e.ctrlKey
      if (wantsSend && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submit()
      }
    }
  }

  return (
    <div
      className={`composer${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          void addFiles(e.dataTransfer.files)
        }
      }}
    >
      {commands.length ? (
        <div className="cmd-list" role="listbox" ref={cmdList}>
          {!chat.commands.length ? <div className="cmd-loading">Loading your skills and commands</div> : null}
          {commands.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === cmdIndex}
              className={`cmd${i === cmdIndex ? ' active' : ''}`}
              // Moving, not resting: the list appearing under a still pointer doesn't change the pick.
              onMouseMove={() => i !== cmdIndex && setCmdIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                setText(`/${c.name} `)
                ta.current?.focus()
              }}
            >
              <span className="cmd-name">/{c.name}</span>
              <span className="cmd-desc">{c.description}</span>
              {c.source && !c.builtin ? <span className="cmd-src">{sourceLabel(c.source)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {images.length ? (
        <div className="attachments">
          {images.map((img, i) => (
            <span key={i} className="attachment">
              <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} />
              <button className="attachment-remove" title="Remove" aria-label={`Remove ${img.name}`} onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}>
                <X />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={ta}
        className="composer-input selectable"
        rows={1}
        value={text}
        placeholder={chat.moving ? 'Moving this chat to another project' : busy ? 'Add to the conversation. Esc stops Claude' : 'Ask Claude to work in this folder'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commands.length && setCmdDismissed(true)}
        onPaste={(e) => {
          // Excel and Word put a picture of the cells next to their text: the text is what's meant.
          if (e.clipboardData.getData('text/plain').trim()) return
          const files = [...e.clipboardData.files]
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault()
            void addFiles(files)
          }
        }}
        spellCheck={false}
      />
      <div className="composer-bar">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button className="icon-btn" title="Attach images" onClick={() => fileInput.current?.click()}>
          <Paperclip />
        </button>
        <Dropdown
          className="composer-pick"
          icon={<Cpu />}
          value={modelValue}
          options={models.map((m) => ({ value: m.value, label: m.label, description: m.description }))}
          label={modelLabel}
          onChange={(v) => s.setModel(tab.id, v || null)}
          title={`Model: ${modelLabel}`}
          placement="above"
        />
        <Dropdown
          className={`composer-pick mode-${modeValue || 'unset'}`}
          icon={<ShieldCheck />}
          value={modeValue}
          options={MODE_OPTIONS}
          label={modeValue ? undefined : 'Claude default mode'}
          onChange={(v) => v && s.setMode(tab.id, v)}
          title={`Permission mode: ${modeLabel}`}
          placement="above"
        />
        {efforts.length ? (
          <Dropdown
            className="composer-pick"
            icon={<Gauge />}
            value={effortValue}
            options={effortOptions}
            label={effortValue ? EFFORT_LABELS[effortValue] : defaultEffort ? EFFORT_LABELS[defaultEffort] : 'Effort'}
            onChange={(v) => s.setEffort(tab.id, v || null)}
            title={`Effort: ${effortLabel}. How hard Claude thinks before answering`}
            placement="above"
          />
        ) : null}
        <button
          className={`toggle-chip${tab.ultracode ? ' on' : ''}`}
          aria-pressed={tab.ultracode === true}
          title={`Ultracode ${tab.ultracode ? 'on' : 'off'}: Claude plans big jobs as workflows of several agents. Uses more of your limits.`}
          onClick={() => s.setUltracode(tab.id, !tab.ultracode)}
        >
          <Workflow />
          <span className="chip-label">Ultracode</span>
        </button>
        <span className="composer-spacer" />
        <ContextMeter info={chat.context} />
        {busy ? (
          <button className="send stop" title="Stop (Esc)" onClick={() => s.interrupt(tab.id)}>
            <Square />
          </button>
        ) : null}
        <button className="send" title={settings.sendWithCtrlEnter ? 'Send (Ctrl+Enter)' : 'Send (Enter)'} disabled={(!text.trim() && !images.length) || chat.moving} onClick={submit}>
          <ArrowUp />
        </button>
      </div>
    </div>
  )
})
