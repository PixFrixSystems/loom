import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_SIZE = 1024 * 1024

export interface FileLogger {
  info(message?: unknown): void
  warn(message?: unknown): void
  error(message?: unknown): void
  debug(message: string): void
}

function describe(message: unknown): string {
  if (typeof message === 'string') return message
  if (message instanceof Error) return message.stack ?? message.message
  try {
    return JSON.stringify(message) ?? String(message)
  } catch {
    return String(message)
  }
}

/**
 * Appends timestamped lines to a file. Past about 1 MB the file becomes `<name>.old` and a new one
 * starts. Writes are synchronous because the lines that matter most are the last ones before Loom
 * quits to install an update. Logging never throws.
 */
export function fileLogger(file: string): FileLogger {
  const write = (level: string, message: unknown): void => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      try {
        if (statSync(file).size > MAX_SIZE) renameSync(file, `${file}.old`)
      } catch {
        // no log yet
      }
      appendFileSync(file, `${new Date().toISOString()} ${level} ${describe(message)}\n`, 'utf8')
    } catch {
      // never in the way of what is being logged
    }
  }
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: (m) => write('debug', m)
  }
}
