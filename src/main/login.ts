import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { spawn, type IPty } from '@lydell/node-pty'
import type { LoginState } from '@shared/types'
import { userEnv } from './servers'

// Signing in runs Claude Code's own `claude auth login`, out of sight: Loom shows the steps
// itself (the browser, a box for the code) instead of a terminal. It runs in a pseudo-terminal
// because Claude Code only asks for a code when it has one to read from.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

let run: { pty: IPty; out: string } | null = null
let state: LoginState = { status: 'idle' }

function setState(next: LoginState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('login:state', state)
}

export function loginState(): LoginState {
  return state
}

/** The sign-in address Claude Code prints, as a terminal hyperlink or as plain text. */
function signInUrl(raw: string): string | undefined {
  const linked = raw.match(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b\s]+)/)?.[1]
  if (linked) return linked
  return raw.replace(ANSI, '').match(/https:\/\/\S*oauth\S*/i)?.[0]
}

/**
 * Starts signing in. `exe` is the Claude Code program; `onDone` runs once it reports success.
 * Starting again while one runs just shows the one that runs.
 */
export function startLogin(exe: string, onDone: () => void): LoginState {
  if (run) return state
  let pty: IPty
  try {
    // Through PowerShell, like a terminal tab, so any Claude Code program runs (an .exe or a script).
    pty = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `& '${exe.replace(/'/g, "''")}' auth login`], {
      name: 'xterm-256color',
      // Wide, so the long sign-in address isn't wrapped onto several lines.
      cols: 600,
      rows: 30,
      cwd: homedir(),
      env: userEnv(),
      useConpty: true
    })
  } catch (e) {
    setState({ status: 'failed', message: `Claude Code could not start: ${(e as Error).message}` })
    return state
  }
  const current = { pty, out: '' }
  run = current
  setState({ status: 'waiting' })
  let succeeded = false
  pty.onData((data) => {
    current.out = (current.out + data).slice(-20000)
    if (!state.url) {
      const url = signInUrl(current.out)
      if (url) setState({ ...state, url })
    }
    if (!succeeded && /Login successful/i.test(current.out.replace(ANSI, ''))) {
      succeeded = true
      setState({ status: 'done' })
      onDone()
    }
  })
  pty.onExit(({ exitCode }) => {
    if (run !== current) return
    run = null
    if (succeeded) return
    if (exitCode === 0) {
      setState({ status: 'done' })
      onDone()
      return
    }
    if (state.status === 'idle') return
    const lines = current.out
      .replace(ANSI, '')
      .split(/\r?\n|\r/)
      .map((l) => l.trim())
      .filter((l) => l && !/^PS |Paste code here|If the browser didn't open|Opening browser/i.test(l))
    setState({ status: 'failed', message: lines.at(-1) ?? `Signing in stopped (code ${exitCode}).` })
  })
  return state
}

/** The code the sign-in page shows, typed in where Claude Code asks for it. */
export function submitLoginCode(code: string): void {
  const clean = code.replace(/[\r\n]+/g, '').trim()
  if (run && clean) run.pty.write(`${clean}\r`)
}

export function cancelLogin(): void {
  const current = run
  run = null
  setState({ status: 'idle' })
  try {
    current?.pty.kill()
  } catch {
    // already gone
  }
}
