import { Check, Download, FolderPlus, LoaderCircle, LogIn, MessageSquarePlus, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthStatus, ChatProvider, PermissionMode } from '@shared/types'
import { normPath, projectForPath, timeAgo } from '../lib/paths'
import { chatProviders, EXTERNAL_MODE_OPTIONS, externalPermissionMode } from '../lib/providers'
import { useStore } from '../store'
import { MODE_OPTIONS } from './Composer'
import { Dropdown } from './Menu'
import { ProjectMark } from './ProjectMark'
import { SignInPanel } from './SignIn'

const PLANS: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }

export function account(a: AuthStatus, name = 'Claude'): string {
  const who = a.email ? `Signed in as ${a.email}` : 'Signed in'
  if (a.method === 'console') return `${who}, through the Anthropic Console (API billing).`
  const plan = a.plan ? PLANS[a.plan] ?? a.plan : null
  return plan ? `${who}, on the ${name} ${plan} plan.` : `${who}.`
}

function Step({ state, title, children }: { state: 'done' | 'current' | 'open'; title: string; children: ReactNode }): ReactNode {
  return (
    <li className={`start-step is-${state}`}>
      <span className="start-mark" aria-hidden="true">
        {state === 'done' ? <Check /> : null}
      </span>
      <div className="start-body">
        <h2>
          {title}
          {state === 'done' ? <span className="visually-hidden"> (done)</span> : null}
        </h2>
        {children}
      </div>
    </li>
  )
}

/**
 * The getting-started steps: Claude signed in, a project or two added, how much Claude may do on
 * its own, then a first chat. Each step does the real thing; nothing here is a tour.
 */
export function Onboarding({ visible }: { visible: boolean }): ReactNode {
  const info = useStore((s) => s.info)
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const settings = useStore((s) => s.settings)
  const externalName = useStore((s) => s.externalName)
  const externalAccountName = useStore((s) => s.externalAccountName)
  const externalAuth = useStore((s) => s.externalAuth)
  const externalLoginSupported = useStore((s) => s.externalLoginSupported)
  const externalInstallUrl = useStore((s) => s.externalInstallUrl)
  const externalProgram = useStore((s) => s.settings.externalProgram?.trim() || s.detectedExternalProgram)
  const external = settings.defaultProvider === 'external'
  const onboarded = useStore((s) => s.onboarded)
  const hasChats = useStore((s) => s.tabs.some((t) => t.kind === 'chat'))
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signingInExternal, setSigningInExternal] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [exists, setExists] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [showAll, setShowAll] = useState(false)

  const check = async (): Promise<void> => {
    setChecking(true)
    setAuth(await window.loom.authStatus().catch((e: Error) => ({ loggedIn: false, error: e.message })))
    setChecking(false)
  }

  useEffect(() => {
    if (!external) void check()
    else if (visible) void useStore.getState().refreshExternalAuth()
  }, [external, visible])

  // Signed out and looking at the steps: check every few seconds, so the step turns green by itself.
  useEffect(() => {
    if (!visible || external || !auth || auth.loggedIn) return
    const t = setInterval(() => void check(), 3000)
    return () => clearInterval(t)
  }, [visible, external, auth?.loggedIn])

  // Folders this person already used with Claude Code, newest first, that aren't in Loom yet.
  const candidates = useMemo(() => {
    const home = info ? normPath(info.homeDir) : ''
    const byFolder = new Map<string, { path: string; chats: number; last: number }>()
    for (const x of sessions) {
      if (!x.cwd || /\\appdata\\local\\temp\\/i.test(x.cwd) || /^[a-z]:[\\/]?$/i.test(x.cwd)) continue
      const key = normPath(x.cwd)
      if (key === home || projectForPath(projects, x.cwd)) continue
      const e = byFolder.get(key) ?? { path: x.cwd, chats: 0, last: 0 }
      e.chats++
      e.last = Math.max(e.last, x.lastModified)
      byFolder.set(key, e)
    }
    return [...byFolder.values()].sort((a, b) => b.last - a.last)
  }, [sessions, projects, info])

  useEffect(() => {
    const unknown = candidates.map((c) => c.path).filter((p) => !(normPath(p) in exists))
    if (!unknown.length) return
    void window.loom.dirsExist(unknown).then((r) => setExists((e) => ({ ...e, ...Object.fromEntries(unknown.map((p, i) => [normPath(p), r[i]])) })))
  }, [candidates])

  // Every folder still on disk, newest first; the first eight show until asked for the rest.
  const suggestions = candidates.filter((c) => exists[normPath(c.path)] === true)
  const shown = showAll ? suggestions : suggestions.slice(0, 8)
  const isPicked = (path: string): boolean =>
    picked ? picked.has(normPath(path)) : suggestions.slice(0, 5).some((x) => normPath(x.path) === normPath(path))
  const pickedPaths = suggestions.filter((x) => isPicked(x.path)).map((x) => x.path)
  const allPicked = pickedPaths.length === suggestions.length
  const toggle = (path: string): void => {
    const next = new Set(picked ?? suggestions.slice(0, 5).map((x) => normPath(x.path)))
    const k = normPath(path)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setPicked(next)
  }

  const s = useStore.getState()
  const signedIn = !!(external ? externalAuth : auth)?.loggedIn
  const haveProjects = projects.length > 0
  const chatted = onboarded === true || hasChats
  const current = !signedIn ? 'signin' : !haveProjects ? 'projects' : !chatted ? 'chat' : null
  const stateOf = (key: string, done: boolean): 'done' | 'current' | 'open' => (done ? 'done' : current === key ? 'current' : 'open')
  const mode: PermissionMode | null = external ? externalPermissionMode(settings.defaultExternalPermissionMode) : settings.defaultPermissionMode
  const modes = external ? EXTERNAL_MODE_OPTIONS : MODE_OPTIONS
  const name = external ? externalName : 'Claude'
  const recent = projects.slice(-4).reverse()

  const skip = (): void => {
    s.set({ onboarded: true })
    const tab = s.tabs.find((t) => t.kind === 'start')
    if (tab) s.closeTab(tab.id)
  }

  return (
    <div className="start">
      <div className="start-inner">
        <header className="start-head">
          <div>
            <h1>Get started with Loom</h1>
            <p>
              Chat, edit files, run dev servers and use git in one window.
            </p>
          </div>
          <button className="btn ghost" onClick={skip}>
            Skip for now
          </button>
        </header>

        {info && info.platform !== 'win32' ? (
          <p className="start-warn">Loom is made for Windows. Chats should work here, but terminals and dev servers may not.</p>
        ) : null}

        <ol className="start-steps">
          <Step state={stateOf('signin', signedIn)} title={external ? `Sign in to ${externalAccountName}` : 'Sign in to Claude'}>
            <div className="start-actions">
              <Dropdown<ChatProvider>
                title="Agent for new chats"
                value={settings.defaultProvider ?? 'claude'}
                options={chatProviders(externalName)}
                onChange={(provider) => s.rememberChoice({ defaultProvider: provider })}
              />
            </div>
            {external ? (
              !externalProgram || externalAuth?.missing ? (
                <div className="start-actions">
                  {externalInstallUrl ? <button className="btn" onClick={() => void window.loom.openExternal(externalInstallUrl)}><Download /> Install {externalName}</button> : null}
                  <button className="btn primary" onClick={s.openSettings}>Set up {externalName}</button>
                </div>
              ) : !externalAuth ? (
                <p className="start-status"><LoaderCircle className="spin" /> Checking whether {externalName} is signed in on this PC</p>
              ) : externalAuth.loggedIn ? (
                <p>{account(externalAuth, externalAccountName)} Loom and the {externalName} CLI share this sign-in.</p>
              ) : signingInExternal ? (
                <SignInPanel provider="external" onEnd={() => {
                  setSigningInExternal(false)
                  void s.refreshExternalAuth()
                }} />
              ) : (
                <>
                  <p>{externalAuth.error ?? (externalLoginSupported ? `Sign in with ${externalAccountName} to use ${externalName}.` : `Sign in using the ${externalName} CLI in a terminal.`)}</p>
                  <div className="start-actions">
                    {externalLoginSupported ? <button className="btn primary" onClick={() => setSigningInExternal(true)}><LogIn /> Sign in with {externalAccountName}</button> : null}
                    <button className="btn ghost" onClick={() => void s.refreshExternalAuth()}><RotateCw /> Check again</button>
                  </div>
                </>
              )
            ) : auth === null ? (
              <p className="start-status">
                <LoaderCircle className="spin" /> Checking whether Claude is signed in on this PC
              </p>
            ) : signedIn ? (
              <p>{account(auth)} Loom uses this sign-in, along with your Claude Code settings, skills and hooks.</p>
            ) : auth.missing ? (
              <>
                <p>Loom chats through Claude Code, Anthropic&apos;s command-line tool, and it isn&apos;t on this PC yet. Install it first, then sign in here.</p>
                {installing ? (
                  <p className="start-hint">Anthropic&apos;s installer is running in the terminal beside this. When it finishes, this step moves on by itself.</p>
                ) : null}
                <div className="start-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      setInstalling(true)
                      s.openInstallTerminal()
                    }}
                  >
                    <Download /> Install Claude Code
                  </button>
                  <button className="btn ghost" disabled={checking} onClick={() => void check()}>
                    {checking ? <LoaderCircle className="spin" /> : <RotateCw />} Check again
                  </button>
                </div>
              </>
            ) : auth.error ? (
              <>
                <p>Loom could not run Claude Code: {auth.error}</p>
                <p className="start-hint">Pick another Claude Code program in Settings, or reinstall it.</p>
              </>
            ) : (
              <>
                <p>Loom chats through Claude Code and uses its sign-in. This PC isn&apos;t signed in yet.</p>
                {signingIn ? (
                  <SignInPanel
                    onEnd={() => {
                      setSigningIn(false)
                      void check()
                    }}
                  />
                ) : null}
                <div className="start-actions" hidden={signingIn}>
                  <button className="btn primary" onClick={() => setSigningIn(true)}>
                    <LogIn /> Sign in
                  </button>
                  <button className="btn ghost" disabled={checking} onClick={() => void check()}>
                    {checking ? <LoaderCircle className="spin" /> : <RotateCw />} Check again
                  </button>
                </div>
              </>
            )}
          </Step>

          <Step state={stateOf('projects', haveProjects)} title="Add your projects">
            <p>A project is a folder. Its chats, files, terminals and dev servers stay together, and the agent works inside it.</p>
            {suggestions.length ? (
              <>
                <div className="start-label-row">
                  <p className="start-label">
                    Folders from your chat history <span className="start-count">{suggestions.length}</span>
                  </p>
                  <button
                    className="start-link"
                    onClick={() => setPicked(new Set(allPicked ? [] : suggestions.map((x) => normPath(x.path))))}
                  >
                    {allPicked ? 'Untick all' : 'Tick all'}
                  </button>
                </div>
                <div className="start-folders" role="group" aria-label="Folders to add">
                  {shown.map((x) => (
                    <label key={x.path} className="start-folder">
                      <input type="checkbox" className="check" checked={isPicked(x.path)} onChange={() => toggle(x.path)} />
                      <span className="start-folder-text">
                        <span className="start-folder-name">{x.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}</span>
                        <span className="start-folder-path">{x.path}</span>
                      </span>
                      <span className="start-folder-meta">
                        {x.chats === 1 ? '1 chat' : `${x.chats} chats`}, {timeAgo(x.last)}
                      </span>
                    </label>
                  ))}
                  {suggestions.length > 8 ? (
                    <button className="start-more" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show fewer' : `Show ${suggestions.length - 8} more`}
                    </button>
                  ) : null}
                </div>
                <div className="start-actions">
                  <button className="btn primary" disabled={!pickedPaths.length} onClick={() => pickedPaths.forEach((p) => s.addProject(p))}>
                    <FolderPlus /> {pickedPaths.length === 1 ? 'Add 1 project' : `Add ${pickedPaths.length} projects`}
                  </button>
                  <button className="btn ghost" onClick={() => void s.pickAndAddProject(null)}>
                    Choose another folder…
                  </button>
                </div>
              </>
            ) : (
              <div className="start-actions">
                <button className={`btn${haveProjects ? ' ghost' : ' primary'}`} onClick={() => void s.pickAndAddProject(null)}>
                  <FolderPlus /> {haveProjects ? 'Add another folder' : 'Add a project folder'}
                </button>
              </div>
            )}
            {haveProjects ? (
              <p className="start-hint">
                In Loom now: {projects.slice(0, 3).map((p) => p.name).join(', ')}
                {projects.length > 3 ? ` and ${projects.length - 3} more` : ''}. They are in the sidebar on the left.
              </p>
            ) : null}
          </Step>

          <Step state="open" title={`Choose what ${name} may do without asking`}>
            <p>New {name} chats start this way. You can change the mode from the message box, and Loom remembers your last pick.</p>
            <div className="start-modes" role="radiogroup" aria-label="Permission mode for new chats">
              {modes.map((m) => (
                <label key={m.value} className="start-mode">
                  <input
                    type="radio"
                    className="radio"
                    name="start-mode"
                    checked={mode === m.value}
                    onChange={() => s.rememberChoice(external ? { defaultExternalPermissionMode: m.value } : { defaultPermissionMode: m.value })}
                  />
                  <span>
                    <span className="start-mode-label">{m.label}</span>
                    <span className="start-mode-desc">{m.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Step>

          <Step state={stateOf('chat', chatted)} title="Start a chat">
            <p>Ask {name} to explain the code, fix a bug, start the dev server, or commit and push your work.</p>
            {recent.length ? (
              <div className="start-actions">
                {recent.map((p, i) => (
                  <button
                    key={p.id}
                    className={`btn${i === 0 && !chatted ? ' primary' : ''}`}
                    onClick={() => {
                      s.set({ onboarded: true })
                      s.newChat(p.id)
                    }}
                  >
                    <ProjectMark project={p} size={14} />
                    <MessageSquarePlus /> New chat in {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="start-hint">Add a project first; its chats start here.</p>
            )}
          </Step>
        </ol>

        <section className="start-tips">
          <h2>Good to know</h2>
          <dl>
            <dt>
              <kbd>Ctrl</kbd> <kbd>T</kbd>
            </dt>
            <dd>A new chat in the project you&apos;re in.</dd>
            <dt>
              <kbd>Ctrl</kbd> <kbd>P</kbd>
            </dt>
            <dd>Open any file of the project.</dd>
            <dt>Drag a tab</dt>
            <dd>Onto the edge of a pane to work side by side, or out of the window to give it a window of its own.</dd>
            <dt>Right-click a project</dt>
            <dd>Run its dev server, give it an icon, or put it in a group.</dd>
            <dt>The Git tab</dt>
            <dd>In the panel on the right: see what changed, commit and push.</dd>
          </dl>
          {chatted ? <p className="start-hint">These steps are in Settings whenever you want them again.</p> : null}
        </section>
      </div>
    </div>
  )
}
