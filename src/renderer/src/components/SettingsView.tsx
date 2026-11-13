import { BellRing, LogIn, LogOut, Play, RefreshCw } from 'lucide-react'
import { DEFAULT_VOLUME, playTone, TONES } from '../lib/tones'
import { useEffect, useState, type ReactNode } from 'react'
import type { AuthStatus, ChatProvider, ClaudeSource, LoomSettings, NotifySound, PermissionMode, ShellChoice, UpdateStatus } from '@shared/types'
import { timeAgo } from '../lib/paths'
import { chatProviders, EXTERNAL_MODE_OPTIONS, externalPermissionMode } from '../lib/providers'
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

function AccountRow({ provider = 'claude' }: { provider?: ChatProvider }): ReactNode {
  const s = useStore.getState()
  const external = provider === 'external'
  const externalName = useStore((st) => st.externalName)
  const externalAccountName = useStore((st) => st.externalAccountName)
  const loginSupported = useStore((st) => st.externalLoginSupported)
  const externalAuth = useStore((st) => st.externalAuth)
  const externalProgram = useStore((st) => st.settings.externalProgram?.trim() || st.detectedExternalProgram)
  const name = external ? externalName : 'Claude'
  const accountName = external ? externalAccountName : name
  const canLogin = !external || loginSupported
  const [claudeAuth, setClaudeAuth] = useState<AuthStatus | null>(null)
  const auth = external ? externalAuth : claudeAuth
  const [busy, setBusy] = useState<'out' | 'waiting' | null>(null)
  const check = async (): Promise<AuthStatus> => {
    if (external) return s.refreshExternalAuth()
    const a = await window.loom.authStatus().catch((e: Error) => ({ loggedIn: false, error: e.message }) as AuthStatus)
    const key = a.loggedIn ? (a.email ?? 'signed in') : null
    if (lastAccount !== null && key && key !== lastAccount) window.loom.accountChanged()
    if (key) lastAccount = key
    setClaudeAuth(a)
    return a
  }
  useEffect(() => {
    void check()
  }, [])
  useEffect(() => {
    if (!external) return
    const onFocus = (): void => void s.refreshExternalAuth()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [external])

  const signOut = async (): Promise<boolean> => {
    setBusy('out')
    const logout = external ? window.loom.externalLogout : window.loom.logout
    const r = await logout().catch((e: Error) => ({ ok: false, error: e.message }))
    await check()
    setBusy(null)
    if (!r.ok) s.showToast(`Couldn't sign out: ${r.error ?? `${name} did not answer.`}`)
    return r.ok
  }
  const signIn = (): void => setBusy('waiting')

  const hint =
    auth === null
      ? 'Checking the sign-in on this PC…'
      : auth.missing
        ? external ? `Choose the ${name} executable under Chat agents.` : "Claude Code isn't installed on this PC, so there is no account yet. Get started below installs it."
        : auth.error ? auth.error : auth.loggedIn
          ? `${account(auth, accountName)} ${external ? `Loom and the ${name} CLI share this sign-in.` : 'Chats, plan limits and Claude Code in your terminals all use this account.'}`
          : external && !canLogin ? `Sign in using the ${name} CLI in a terminal.` : `Sign in to ${accountName} to start a ${name} chat.`
  return (
    <Row title={name} hint={hint}>
      {busy === 'waiting' ? (
        <SignInPanel
          provider={provider}
          onEnd={() => {
            setBusy(null)
            void check()
          }}
        />
      ) : null}
      <div className="set-actions" hidden={busy === 'waiting'}>
        {auth?.loggedIn && canLogin ? (
          <>
            <button
              className="btn"
              disabled={!!busy}
              onClick={async () => {
                const pick = await s.ask({
                  title: `Switch to another ${accountName} account?`,
                  body: `This signs ${auth.email ?? 'this account'} out of ${external ? name : 'Claude Code'} on this PC, then opens the sign-in for the account you want.${external ? '' : ' Chats in the middle of a reply finish first.'}`,
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
                  title: `Sign out of ${auth.email ?? name}?`,
                  body: external
                    ? `Signing out affects Loom and the ${name} CLI on this PC. Sign in again to start a new reply.`
                    : 'Claude Code on this PC signs out, in Loom, VS Code and your terminals alike. Chats need you to sign in again before they can reply.',
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
        ) : auth && !auth.loggedIn && !auth.missing && canLogin && (!external || externalProgram) ? (
          <button className="btn primary" disabled={busy === 'out'} onClick={signIn}>
            <LogIn /> {external ? `Sign in with ${accountName}` : 'Sign in'}
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
  const externalName = s.externalName
  // Look again for Claude Code each time Settings opens: it may have been installed since.
  useEffect(() => {
    void window.loom.claudeInfo().then((next) => useStore.getState().set({ info: next }))
  }, [])
  const update = s.rememberChoice
  const [program, setProgram] = useState(st.externalProgram ?? '')
  const path = program.trim()
  const validProgram = !path || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\).+\.exe$/i.test(path)
  const saveProgram = (next: string): void => {
    if (next !== (useStore.getState().settings.externalProgram ?? '')) update({ externalProgram: next })
  }

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
          <AccountRow provider="external" />
          <ServiceAccounts />
        </section>

        <section className="set-section">
          <h2>Chat agents</h2>
          <Row title="Agent for new chats" hint="You can also choose an agent in a chat before sending the first message.">
            <Dropdown<ChatProvider>
              title="Agent for new chats"
              value={st.defaultProvider ?? 'claude'}
              options={chatProviders(externalName)}
              onChange={(value) => update({ defaultProvider: value })}
            />
          </Row>
          <Row
            title={`${externalName} executable`}
            hint={!validProgram ? 'Enter a full path to an .exe file or use Browse.' : s.externalLoginSupported ? 'Choose the installed executable, then sign in under Accounts.' : 'Choose the installed executable and sign in with its CLI in a terminal.'}
          >
            <div className="inline-field">
              <input
                className="field"
                aria-label={`${externalName} executable`}
                aria-invalid={!validProgram}
                placeholder={s.detectedExternalProgram || 'C:\\path\\to\\agent.exe'}
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                onBlur={() => {
                  if (validProgram) saveProgram(path)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && validProgram) e.currentTarget.blur()
                }}
              />
              <button
                className="btn"
                onClick={async () => {
                  const next = await window.loom.pickFile(`Choose the ${externalName} executable`)
                  if (!next) return
                  setProgram(next)
                  if (/\.exe$/i.test(next)) saveProgram(next)
                }}
              >
                Browse…
              </button>
            </div>
          </Row>
          <Row title={`Permission mode for new ${externalName} chats`} hint={`Choose what ${externalName} can do without asking.`}>
            <Dropdown<PermissionMode>
              value={externalPermissionMode(st.defaultExternalPermissionMode)}
              options={EXTERNAL_MODE_OPTIONS}
              onChange={(value) => update({ defaultExternalPermissionMode: value })}
            />
          </Row>
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
            title="Permission mode for new Claude chats"
            hint="What Claude may do without asking. Picking a mode in a Claude chat changes this too. The same goes for the model, effort and Ultracode."
          >
            <Dropdown<PermissionMode | 'settings'>
              value={st.defaultPermissionMode ?? 'settings'}
              options={[{ value: 'settings', label: 'Follow my Claude settings', description: 'Uses defaultMode from settings.json' }, ...MODE_OPTIONS]}
              onChange={(v) => update({ defaultPermissionMode: v === 'settings' ? null : v })}
            />
          </Row>
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
              {s.update.enabled ? (
                <div className="set-actions">
                  {s.update.state === 'ready' ? (
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
                  <button className="btn ghost" onClick={() => void window.loom.updateNotes()}>
                    What&apos;s new
                  </button>
                </div>
              ) : null}
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
