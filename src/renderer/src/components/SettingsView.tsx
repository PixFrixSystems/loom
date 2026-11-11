import type { ReactNode } from 'react'
import type { ClaudeSource, LoomSettings, PermissionMode, ShellChoice } from '@shared/types'
import { useStore } from '../store'
import { MODE_OPTIONS } from './Composer'
import { Dropdown } from './Menu'

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

export function SettingsView(): ReactNode {
  const s = useStore()
  const st = s.settings
  const info = s.info
  const update = (patch: Partial<LoomSettings>): void => s.set({ settings: { ...st, ...patch } })

  const sources: { value: ClaudeSource; label: string; detail: string }[] = [
    { value: 'bundled', label: 'Bundled with Loom', detail: info?.bundledPath ?? 'Not found' },
    { value: 'installed', label: 'Your installed Claude Code', detail: info?.installedPath ?? 'Not found on this PC' },
    { value: 'custom', label: 'Another program', detail: 'Pick a claude.exe below' }
  ]

  return (
    <div className="settings">
      <div className="settings-inner">
        <h1>Settings</h1>

        <section className="set-section">
          <h2>Claude</h2>
          <Row title="Program that runs your chats" hint="Every option uses your Claude Code sign-in, settings, skills and hooks. Changes apply to chats you start or restart from now on.">
            <div className="radio-list">
              {sources.map((o) => (
                <label key={o.value} className="radio-row">
                  <input type="radio" name="claude-source" checked={st.claudeSource === o.value} onChange={() => update({ claudeSource: o.value })} />
                  <span>
                    <span className="radio-label">{o.label}</span>
                    <span className="radio-detail selectable">{o.detail}</span>
                  </span>
                </label>
              ))}
              {st.claudeSource === 'custom' ? (
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
