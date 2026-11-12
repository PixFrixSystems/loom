import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { spawn, type IPty } from '@lydell/node-pty'
import type { ShellChoice } from '@shared/types'
import { userEnv } from './servers'
import { OutputTail } from './tail'

/** Output kept per terminal so a window that picks it up (a tab moved to another window) can redraw it. */
const MAX_REPLAY = 256 * 1024

interface Term {
  pty: IPty
  web: WebContents
  replay: OutputTail
}

const terms = new Map<string, Term>()

function shellFor(choice: ShellChoice): { file: string; args: string[] } {
  if (choice === 'cmd') return { file: process.env.ComSpec || 'cmd.exe', args: [] }
  if (choice === 'gitbash') {
    const candidates = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
    const found = candidates.find((p) => existsSync(p))
    if (found) return { file: found, args: ['--login', '-i'] }
  }
  return { file: 'powershell.exe', args: ['-NoLogo'] }
}

/**
 * Starts a terminal, or, when one with this id is still running, hands it to the asking window
 * along with its recent output.
 */
export function createTerminal(
  web: WebContents,
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  shell: ShellChoice
): { ok: true; replay?: string } | { ok: false; error: string } {
  const running = terms.get(id)
  if (running) {
    running.web = web
    resizeTerminal(id, cols, rows)
    return { ok: true, replay: running.replay.text() }
  }
  const { file, args } = shellFor(shell)
  try {
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd: existsSync(cwd) ? cwd : process.env.USERPROFILE,
      env: userEnv({ TERM_PROGRAM: 'Loom' }),
      useConpty: true
    })
    const term: Term = { pty, web, replay: new OutputTail(MAX_REPLAY) }
    terms.set(id, term)
    pty.onData((data) => {
      term.replay.push(data)
      if (!term.web.isDestroyed()) term.web.send('pty:data', id, data)
    })
    pty.onExit(({ exitCode }) => {
      if (terms.get(id) === term) terms.delete(id)
      if (!term.web.isDestroyed()) term.web.send('pty:exit', id, exitCode)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function writeTerminal(id: string, data: string): void {
  terms.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const t = terms.get(id)
  if (!t) return
  try {
    t.pty.resize(Math.max(cols, 20), Math.max(rows, 5))
  } catch {
    // the shell may have just exited
  }
}

export function killTerminal(id: string): void {
  const t = terms.get(id)
  if (!t) return
  terms.delete(id)
  try {
    t.pty.kill()
  } catch {
    // already gone
  }
}

export function killAllTerminals(): void {
  for (const id of [...terms.keys()]) killTerminal(id)
}
