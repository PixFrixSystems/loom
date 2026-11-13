import { BellRing, LogIn, LogOut, Pencil, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { DEFAULT_VOLUME, playTone, TONES } from '../lib/tones'
import { useEffect, useState, type ReactNode } from 'react'
import { cleanThemeName, readableSeeds, readCustomThemes } from '@shared/customTheme'
import {
  THEME_SEEDS,
  THEMES,
  type AuthStatus,
  type ClaudeSource,
  type CustomTheme,
  type LoomSettings,
  type NotifySound,
  type PermissionMode,
  type ShellChoice,
  type ThemeChoice,
  type ThemeSeeds,
  type UpdateStatus
} from '@shared/types'
import { timeAgo, uid } from '../lib/paths'
import { useStore } from '../store'
import { MODE_OPTIONS } from './Composer'
import { Dropdown } from './Menu'
import { ServiceAccounts } from './Accounts'
import { account } from './Onboarding'
import { PhoneAccess } from './PhoneAccess'
import { SignInPanel } from './SignIn'

/**
 * Who Loom chats as: the Claude Code sign-in on this PC. Sign out, or switch to another account
 * through the same sign-in terminal Get started uses. While a sign-in runs, it looks every few
 * seconds for the account to change.
 */
/** The account last seen signed in, kept while Settings closes for a sign-in and opens again. */
let lastAccount: string | null = null

function AccountRow(): ReactNode {
  const s = useStore.getState()
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [busy, setBusy] = useState<'out' | 'waiting' | null>(null)
  const check = async (): Promise<AuthStatus> => {
    const a = await window.loom.authStatus().catch((e: Error) => ({ loggedIn: false, error: e.message }) as AuthStatus)
    const key = a.loggedIn ? (a.email ?? 'signed in') : null
    if (lastAccount !== null && key && key !== lastAccount) window.loom.accountChanged()
    if (key) lastAccount = key
    setAuth(a)
    return a
  }
  useEffect(() => {
    void check()
  }, [])

  const signOut = async (): Promise<boolean> => {
    setBusy('out')
    const r = await window.loom.logout()
    await check()
    setBusy(null)
    if (!r.ok) s.showToast(`Couldn't sign out: ${r.error ?? 'Claude Code did not answer.'}`)
    return r.ok
  }
  const signIn = (): void => setBusy('waiting')

  const hint =
    auth === null
      ? 'Checking the sign-in on this PC…'
      : auth.missing
        ? "Claude Code isn't installed on this PC, so there is no account yet. Get started below installs it."
        : auth.loggedIn
          ? `${account(auth)} Chats, plan limits and Claude Code in your terminals all use this account.`
          : 'Not signed in. Chats need a Claude account.'
  return (
    <Row title="Claude" hint={hint}>
      {busy === 'waiting' ? (
        <SignInPanel
          onEnd={() => {
            setBusy(null)
            void check()
          }}
        />
      ) : null}
      <div className="set-actions" hidden={busy === 'waiting'}>
        {auth?.loggedIn ? (
          <>
            <button
              className="btn"
              disabled={!!busy}
              onClick={async () => {
                const pick = await s.ask({
                  title: 'Switch to another Claude account?',
                  body: `This signs ${auth.email ?? 'this account'} out of Claude Code on this PC, then opens the sign-in for the account you want. Chats in the middle of a reply finish first.`,
                  choices: [
                    { id: 'switch', label: 'Sign out and switch', kind: 'primary' },
                    { id: 'cancel', label: 'Cancel', kind: 'ghost' }
                  ],
                  cancel: 'cancel'
                })
                if (pick === 'switch' && (await signOut())) signIn()
              }}
            >
              <RefreshCw /> Switch account
            </button>
            <button
              className="btn danger"
              disabled={!!busy}
              onClick={async () => {
                const pick = await s.ask({
                  title: `Sign out of ${auth.email ?? 'Claude'}?`,
                  body: 'Claude Code on this PC signs out, in Loom, VS Code and your terminals alike. Chats need you to sign in again before they can reply.',
                  choices: [
                    { id: 'out', label: 'Sign out', kind: 'danger' },
                    { id: 'cancel', label: 'Cancel', kind: 'ghost' }
                  ],
                  cancel: 'cancel'
                })
                if (pick === 'out') await signOut()
              }}
            >
              <LogOut /> Sign out
            </button>
          </>
        ) : auth && !auth.missing ? (
          <button className="btn primary" disabled={busy === 'out'} onClick={signIn}>
            <LogIn /> Sign in
          </button>
        ) : null}
      </div>
    </Row>
  )
}

/**
 * How Loom tells you a chat is done (or needs an answer) while you're in another window: a Windows
 * notification, a sound of Loom's own, or both. Says so when Windows has notifications off.
 */
function NotifyRow({
  notifyWhenDone,
  sound,
  volume,
  update
}: {
  notifyWhenDone: boolean
  sound: NotifySound
  volume: number
  update: (patch: Partial<LoomSettings>) => void
}): ReactNode {
  const [windowsOff, setWindowsOff] = useState(false)
  useEffect(() => {
    const look = (): void => void window.loom.notifyOff().then(setWindowsOff)
    look()
    // Back from Windows' settings: look again.
    window.addEventListener('focus', look)
    return () => window.removeEventListener('focus', look)
  }, [])
  return (
    <Row title="Notify me" hint="When a chat finishes, or Claude needs an answer, while you're in another window.">
      <div className="notify-controls">
        <label className="check-row">
          <input type="checkbox" checked={notifyWhenDone} onChange={(e) => update({ notifyWhenDone: e.target.checked })} />
          <span>Windows notification</span>
        </label>
        <div className="notify-sound">
          <span className="notify-sound-label">Sound</span>
          <Dropdown<NotifySound>
            value={sound}
            options={TONES}
            onChange={(v) => {
              update({ notifySound: v })
              playTone(v, volume)
            }}
          />
          <button className="icon-btn" title="Play this sound" aria-label="Play this sound" disabled={sound === 'off'} onClick={() => playTone(sound, volume)}>
            <Play />
          </button>
        </div>
        <label className="notify-volume">
          <span className="notify-sound-label">Volume</span>
          <input
            type="range"
            className="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            disabled={sound === 'off'}
            style={{ ['--fill' as string]: `${volume}%` }}
            aria-valuetext={`${volume}%`}
            onChange={(e) => update({ notifyVolume: Number(e.target.value) })}
            // A preview once you let go, not on every step of the drag.
            onPointerUp={(e) => playTone(sound, Number(e.currentTarget.value))}
            onKeyUp={(e) => e.key.startsWith('Arrow') && playTone(sound, Number(e.currentTarget.value))}
          />
          <span className="notify-volume-value">{volume}%</span>
        </label>
        <button className="btn" onClick={() => window.loom.notifyTest()}>
          <BellRing /> Send a test
        </button>
        {windowsOff && notifyWhenDone ? (
          <p className="notify-warn">
            Windows has notifications turned off, so it won&apos;t show Loom&apos;s. A sound still plays if you pick one.{' '}
            <button className="link-btn" onClick={() => window.loom.notifySettings()}>
              Open Windows notification settings
            </button>
          </p>
        ) : null}
      </div>
    </Row>
  )
}

/**
 * The model new chats start with: the one picked last in a chat (as before), Claude Code's own
 * default, or one chosen here for good.
 */
function ModelRow({ value, update }: { value: string | null | undefined; update: (patch: Partial<LoomSettings>) => void }): ReactNode {
  const known = useStore((s) => s.knownModels)
  const last = useStore((s) => s.settings.defaultModel ?? '')
  const claudeDefault = known.find((m) => m.value === '')
  const nameOf = (v: string): string => (v ? (known.find((m) => m.value === v)?.label ?? v) : `Claude Code's default${claudeDefault?.description ? ` (${claudeDefault.description.split(' · ')[0]})` : ''}`)
  const options = [
    { value: 'last', label: 'The one I picked last', description: `Now ${nameOf(last)}. Picking a model in any chat changes it` },
    { value: '', label: "Claude Code's default", description: claudeDefault?.description ?? 'What Claude Code recommends for your account' },
    ...known.filter((m) => m.value !== '').map((m) => ({ value: m.value, label: m.label, description: m.description }))
  ]
  // A model that is no longer offered still shows as chosen, by its name.
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: value, description: 'Not in the current list of models' })
  return (
    <Row
      title="Model for new chats"
      hint="Choose a model and every new chat starts with it; picking another in a chat then changes only that chat. Claude Code's default is what Claude Code recommends on this PC, and can differ from one account or version to another."
    >
      <Dropdown<string> value={value == null ? 'last' : value} options={options} onChange={(v) => update({ newChatModel: v === 'last' ? null : v })} />
    </Row>
  )
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {hint ? <div className="set-hint">{hint}</div> : null}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

/** A theme being made: new, or a saved one being changed (its id) */
type Draft = { id: CustomTheme['id'] | null; name: string; colours: ThemeSeeds }

/**
 * The theme, and themes of your own: describe one and Claude picks the colours on your Claude
 * account, then change any colour by hand. The draft shows across this window while you work on
 * it (the store's themePreview); Save keeps it and wears it, leaving Settings drops it.
 */
function AppearanceSection(): ReactNode {
  const st = useStore((s) => s.settings)
  const own = readCustomThemes(st.customThemes)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    useStore.getState().set({ themePreview: draft && { name: draft.name, colours: draft.colours } })
  }, [draft])
  useEffect(() => () => useStore.getState().set({ themePreview: null }), [])

  const setSettings = (patch: Partial<LoomSettings>): void => {
    const s = useStore.getState()
    s.set({ settings: { ...s.settings, ...patch } })
  }

  const ask = async (): Promise<void> => {
    const description = text.trim()
    if (!description || busy) return
    setBusy(true)
    setError(null)
    const r = await window.loom.writeTheme(description, draft && { name: draft.name, colours: draft.colours })
    setBusy(false)
    if (!r.colours) return setError(r.error ?? 'Claude did not answer. Try again.')
    // Claude's colours arrive already made readable, so the pickers show what the window shows.
    setDraft({ id: draft?.id ?? null, name: r.name ?? draft?.name ?? 'My theme', colours: readableSeeds(r.colours) })
    setText('')
  }

  const save = (): void => {
    if (!draft) return
    const id = draft.id ?? (`custom-${uid()}` as CustomTheme['id'])
    const theme: CustomTheme = { id, name: cleanThemeName(draft.name), colours: draft.colours }
    const list = readCustomThemes(useStore.getState().settings.customThemes)
    setSettings({ customThemes: list.some((t) => t.id === id) ? list.map((t) => (t.id === id ? theme : t)) : [...list, theme], theme: id })
    setDraft(null)
  }

  const remove = async (t: CustomTheme): Promise<void> => {
    const pick = await useStore.getState().ask({
      title: `Delete ${t.name}?`,
      body: "It can't be brought back. If it's the theme in use, Loom goes back to its own colours.",
      choices: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'ghost' }
      ],
      cancel: 'cancel'
    })
    if (pick !== 'delete') return
    const now = useStore.getState().settings
    setSettings({ customThemes: readCustomThemes(now.customThemes).filter((x) => x.id !== t.id), theme: now.theme === t.id ? 'loom' : now.theme })
    if (draft?.id === t.id) setDraft(null)
  }

  const choices = [...THEMES, ...own.map((t) => ({ value: t.id, label: t.name, description: 'Your own theme' }))]
  const chosen = choices.some((c) => c.value === st.theme) ? st.theme! : 'loom'
  const shown = draft && readableSeeds(draft.colours)

  return (
    <section className="set-section">
      <h2>Appearance</h2>
      <Row title="Theme" hint="The colours of every window: chats, files, the editor and terminals.">
        <Dropdown<ThemeChoice>
          value={chosen}
          options={choices}
          onChange={(v) => {
            setDraft(null)
            setSettings({ theme: v })
          }}
        />
      </Row>
      <Row
        title="Make your own"
        hint="Describe a theme and Claude picks the colours, using your Claude account. You see it everywhere at once, can change any colour, and keep it with Save."
      >
        <div className="theme-maker">
          <div className="inline-field">
            <input
              className="field"
              aria-label={draft ? 'What should change' : 'Describe a theme'}
              placeholder={draft ? 'More gold, less red…' : 'Marvel heroes, Iron Man red and gold…'}
              value={text}
              maxLength={400}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void ask()}
            />
            <button className="btn" disabled={busy || !text.trim()} onClick={() => void ask()}>
              <Sparkles /> {busy ? 'Choosing…' : draft ? 'Change it' : 'Create'}
            </button>
          </div>
          <p className="theme-status" aria-live="polite">
            {busy ? 'Claude is choosing colours. This takes a few seconds.' : draft ? `Showing ${draft.name || 'your theme'}. Save it to keep it.` : ''}
          </p>
          {error ? (
            <p className="theme-error" role="alert">
              {error}
            </p>
          ) : null}
          {own.length ? (
            <ul className="theme-own" aria-label="Your themes">
              {own.map((t) => (
                <li key={t.id}>
                  <span className="theme-chip" style={{ background: t.colours.background, borderColor: t.colours.accent }} aria-hidden="true" />
                  <span className="theme-own-name">{t.name}</span>
                  <button
                    className="icon-btn"
                    title={`Change ${t.name}`}
                    aria-label={`Change ${t.name}`}
                    onClick={() => {
                      setError(null)
                      setDraft({ id: t.id, name: t.name, colours: t.colours })
                    }}
                  >
                    <Pencil />
                  </button>
                  <button className="icon-btn" title={`Delete ${t.name}`} aria-label={`Delete ${t.name}`} onClick={() => void remove(t)}>
                    <Trash2 />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Row>
      {draft && shown ? (
        <div className="theme-draft">
          <label className="theme-name">
            <span>Name</span>
            <input className="field" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="swatches">
            {THEME_SEEDS.map(({ key, label, hint }) => (
              <label key={key} className="swatch" title={hint}>
                <input type="color" value={draft.colours[key]} onChange={(e) => setDraft({ ...draft, colours: { ...draft.colours, [key]: e.target.value } })} />
                <span className="swatch-label">{label}</span>
                {shown[key] !== draft.colours[key] ? <span className="swatch-note">Adjusted on screen so it stays readable</span> : null}
              </label>
            ))}
          </div>
          <div className="set-actions">
            <button className="btn primary" onClick={save}>
              Save theme
            </button>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** What the About section says about updates. */
function updateLine(u: UpdateStatus): string {
  if (!u.enabled) return 'This copy is built from source. Update it with git pull, then npm run build.'
  switch (u.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading Loom ${u.available}${u.percent ? ` (${u.percent}%)` : ''}. A Restart to update button appears when it's ready.`
    case 'ready':
      return `Loom ${u.available} is ready. Restart to install it; your tabs and chats come back.`
    case 'none':
      return `Loom is up to date.${u.checkedAt ? ` Checked ${timeAgo(u.checkedAt)}.` : ''}`
    case 'error':
      return `Couldn't check for updates. ${u.error ?? ''}`.trim()
    default:
      return 'Loom looks for updates when it starts and every few hours.'
  }
}

export function SettingsView(): ReactNode {
  const s = useStore()
  const st = s.settings
  const info = s.info
  // Look again for Claude Code each time Settings opens: it may have been installed since.
  useEffect(() => {
    void window.loom.claudeInfo().then((next) => useStore.getState().set({ info: next }))
  }, [])
  const update = (patch: Partial<LoomSettings>): void => s.set({ settings: { ...st, ...patch } })

  // The installed Loom app has no bundled copy; there "bundled" quietly means the installed one.
  const hasBundled = !!info?.bundledPath
  const source: ClaudeSource = st.claudeSource === 'bundled' && info && !hasBundled ? 'installed' : st.claudeSource
  const sources: { value: ClaudeSource; label: string; detail: string }[] = [
    ...(hasBundled || !info ? [{ value: 'bundled' as const, label: 'Bundled with Loom', detail: info?.bundledPath ?? '' }] : []),
    { value: 'installed', label: 'Your installed Claude Code', detail: info?.installedPath ?? 'Not found on this PC' },
    { value: 'custom', label: 'Another program', detail: 'Pick a claude.exe below' }
  ]

  return (
    <div className="settings">
      <div className="settings-inner">
        <h1>Settings</h1>

        <section className="set-section">
          <h2>Accounts</h2>
          <AccountRow />
          <ServiceAccounts />
        </section>

        <section className="set-section">
          <h2>Claude</h2>
          <Row title="Program that runs your chats" hint="Every option uses your Claude Code sign-in, settings, skills and hooks. Changes apply to chats you start or restart from now on.">
            <div className="radio-list">
              {sources.map((o) => (
                <label key={o.value} className="radio-row">
                  <input type="radio" name="claude-source" checked={source === o.value} onChange={() => update({ claudeSource: o.value })} />
                  <span>
                    <span className="radio-label">{o.label}</span>
                    <span className="radio-detail selectable">{o.detail}</span>
                  </span>
                </label>
              ))}
              {source === 'custom' ? (
                <div className="inline-field">
                  <input
                    className="field"
                    placeholder="C:\path\to\claude.exe"
                    value={st.claudeCustomPath}
                    aria-invalid={!st.claudeCustomPath.trim()}
                    onChange={(e) => update({ claudeCustomPath: e.target.value })}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      const p = await window.loom.pickFile('Choose claude.exe')
                      if (p) update({ claudeCustomPath: p })
                    }}
                  >
                    Browse…
                  </button>
                </div>
              ) : null}
            </div>
          </Row>
          <Row
            title="Permission mode for new chats"
            hint="What Claude may do without asking. Picking a mode in any chat's message box changes this too, so new chats start the way you last worked. The same goes for effort and Ultracode."
          >
            <Dropdown<PermissionMode | 'settings'>
              value={st.defaultPermissionMode ?? 'settings'}
              options={[{ value: 'settings', label: 'Follow my Claude settings', description: 'Uses defaultMode from settings.json' }, ...MODE_OPTIONS]}
              onChange={(v) => update({ defaultPermissionMode: v === 'settings' ? null : v })}
            />
          </Row>
          <ModelRow value={st.newChatModel} update={update} />
          <Row title="Send messages with" hint="The other combination adds a new line.">
            <div className="segmented">
              <button aria-selected={!st.sendWithCtrlEnter} onClick={() => update({ sendWithCtrlEnter: false })}>
                Enter
              </button>
              <button aria-selected={st.sendWithCtrlEnter} onClick={() => update({ sendWithCtrlEnter: true })}>
                Ctrl+Enter
              </button>
            </div>
          </Row>
          <NotifyRow notifyWhenDone={st.notifyWhenDone} sound={st.notifySound ?? 'off'} volume={st.notifyVolume ?? DEFAULT_VOLUME} update={update} />
        </section>

        <AppearanceSection />

        <PhoneAccess />

        <section className="set-section">
          <h2>Backups</h2>
          <Row
            title="Keep copies of moved chats"
            hint="Moving a chat to another project keeps a copy of the original in .claude\chat-backups, in your user folder. Copies older than this are deleted for good."
          >
            <Dropdown<string>
              value={String(st.keepChatBackupsDays ?? 30)}
              options={[
                { value: '7', label: '7 days' },
                { value: '14', label: '14 days' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
                { value: '180', label: '6 months' },
                { value: '365', label: 'A year' },
                { value: '0', label: 'Forever' }
              ]}
              onChange={(v) => update({ keepChatBackupsDays: Number(v) })}
            />
          </Row>
        </section>

        <section className="set-section">
          <h2>Getting started</h2>
          <Row title="The first-launch steps" hint="Signing in to Claude, adding projects, and how much Claude does without asking.">
            <button className="btn" onClick={() => s.openStart()}>
              Show the steps
            </button>
          </Row>
        </section>

        <section className="set-section">
          <h2>Terminal</h2>
          <Row title="Shell" hint="Used for new terminal tabs.">
            <Dropdown<ShellChoice>
              value={st.shell}
              options={[
                { value: 'powershell', label: 'PowerShell' },
                { value: 'cmd', label: 'Command Prompt' },
                { value: 'gitbash', label: 'Git Bash' }
              ]}
              onChange={(v) => update({ shell: v })}
            />
          </Row>
        </section>

        {s.update ? (
          <section className="set-section">
            <h2>About</h2>
            <Row title={`Loom ${s.update.version}`} hint={updateLine(s.update)}>
              {/* What's new for every copy; updating only where Loom updates itself (not from source). */}
              <div className="set-actions">
                {!s.update.enabled ? null : s.update.state === 'ready' ? (
                  <button className="btn primary" onClick={() => void window.loom.updateInstall()}>
                    Restart to update
                  </button>
                ) : (
                  <button
                    className="btn"
                    disabled={s.update.state === 'checking' || s.update.state === 'downloading'}
                    onClick={() => void window.loom.updateCheck()}
                  >
                    Check for updates
                  </button>
                )}
                <button className="btn ghost" onClick={() => s.showWhatsNew()}>
                  What&apos;s new
                </button>
              </div>
            </Row>
          </section>
        ) : null}

        <section className="set-section">
          <h2>Keyboard</h2>
          <dl className="keys">
            {[
              ['New chat in this project', 'Ctrl+T'],
              ['Close tab', 'Ctrl+W'],
              ['Next and previous tab', 'Ctrl+Tab, Ctrl+Shift+Tab'],
              ['Open a file', 'Ctrl+P'],
              ['New terminal', 'Ctrl+`'],
              ['Show or hide the sidebar', 'Ctrl+B'],
              ['Files and Claude panel', 'Ctrl+Alt+B'],
              ['Stop Claude', 'Esc in the message box'],
              ['Save a file', 'Ctrl+S']
            ].map(([what, keys]) => (
              <div key={what} className="key-row">
                <dt>{what}</dt>
                <dd>
                  {keys.split(', ').map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}
