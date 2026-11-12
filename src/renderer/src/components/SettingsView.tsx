import { LogIn, LogOut, RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AuthStatus, ClaudeSource, LoomSettings, PermissionMode, ShellChoice, UpdateStatus } from '@shared/types'
import { timeAgo } from '../lib/paths'
import { useStore } from '../store'
import { MODE_OPTIONS } from './Composer'
import { Dropdown } from './Menu'
import { account } from './Onboarding'
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
    <Row title="Account" hint={hint}>
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
          <h2>Claude</h2>
          <AccountRow />
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
            hint="What Claude may do without asking. Picking a mode in any chat's message box changes this too, so new chats start the way you last worked. The same goes for the model, effort and Ultracode."
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
          <Row title="Notify me" hint="A Windows notification when Claude finishes while Loom is in the background.">
            <label className="check-row">
              <input type="checkbox" checked={st.notifyWhenDone} onChange={(e) => update({ notifyWhenDone: e.target.checked })} />
              <span>When a chat finishes</span>
            </label>
          </Row>
        </section>

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
