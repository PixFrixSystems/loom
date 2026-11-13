import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute, parse } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { inspect } from 'node:util'
import pkg from '../../package.json' with { type: 'json' }

type RequestId = number | string
type Params = Record<string, unknown>

interface ExternalProtocolOptions {
  cwd?: string
  experimentalApi?: boolean
  onNotification?: (method: string, params: Params) => void
  onRequest?: (method: string, params: Params, id: RequestId) => unknown
  onClose?: (error: Error) => void
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000
const EXIT_TIMEOUT_MS = 2_000
const STDERR_LIMIT = 2_000

function record(value: unknown): Params | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Params : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : inspect(error, { depth: 0 })
}

export class ExternalProtocolError extends Error {
  readonly code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'ExternalProtocolError'
    this.code = code
  }
}

/** A newline-delimited JSON-RPC connection to the configured agent process. */
export class ExternalProtocol {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lines: Interface
  private readonly pending = new Map<number, PendingRequest>()
  private readonly ready: Promise<void>
  private readonly options: ExternalProtocolOptions
  private nextId = 1
  private failure: Error | undefined
  private stderr = ''

  constructor(executable: string, options: ExternalProtocolOptions = {}) {
    if (!isAbsolute(executable) || (process.platform === 'win32' && (parse(executable).root.length === 1 || !/\.exe$/i.test(executable)))) {
      throw new Error('Choose the external agent executable using its full path.')
    }

    this.options = options
    this.child = spawn(executable, ['app-server'], { cwd: options.cwd, windowsHide: true })
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line: string) => this.receive(line))
    this.lines.on('error', (error: Error) => this.stop(new Error(`Could not read from the external agent: ${error.message}`)))
    this.child.stdin.on('error', (error) => this.stop(new Error(`Could not write to the external agent: ${error.message}`)))
    this.child.on('error', (error) => this.stop(new Error(`Could not start the external agent: ${error.message}`)))
    this.child.once('close', (code, signal) => {
      const summary = `The external agent exited (${signal ?? `code ${code ?? 'unknown'}`}).`
      const detail = this.stderr.trim()
      this.stop(new Error(detail ? `${summary}\n${detail}` : `${summary} Check the executable and try again.`))
    })
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_LIMIT)
    })

    this.ready = this.initialize()
    void this.ready.catch((error: Error) => this.stop(error))
  }

  async request<T>(method: string, params?: object): Promise<T> {
    await this.ready
    return this.sendRequest(method, params) as Promise<T>
  }

  close(): void {
    this.stop(new Error('The external agent connection closed.'), false)
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      clientInfo: { name: 'loom', title: 'Loom', version: pkg.version },
      capabilities: this.options.experimentalApi ? { experimentalApi: true, requestAttestation: false } : null,
    })
    this.write({ method: 'initialized' })
  }

  private sendRequest(method: string, params?: object): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timeout = setTimeout(() => {
        this.stop(new Error(`The external agent timed out while handling ${method}.`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.write({ id, method, params })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(error)
      }
    })
  }

  private write(message: object): void {
    if (this.failure) throw this.failure
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string): void {
    if (this.failure || !line.trim()) return
    try {
      const message = record(JSON.parse(line))
      if (!message) throw new Error('Expected a JSON object.')

      const { id, method } = message
      if (typeof method === 'string') {
        const params = record(message.params) ?? {}
        if (typeof id === 'number' || typeof id === 'string') void this.respond(id, method, params)
        else this.options.onNotification?.(method, params)
        return
      }

      if (typeof id !== 'number') return
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      const error = record(message.error)
      if (error) {
        pending.reject(new ExternalProtocolError(
          typeof error.message === 'string' ? error.message : 'The external agent returned an error.',
          typeof error.code === 'number' ? error.code : -32603,
        ))
      } else if (Object.hasOwn(message, 'result')) {
        pending.resolve(message.result)
      } else {
        pending.reject(new Error('The external agent returned an incomplete response.'))
      }
    } catch (error) {
      this.stop(new Error(`Could not handle a message from the external agent: ${errorMessage(error)}`))
    }
  }

  private async respond(id: RequestId, method: string, params: Params): Promise<void> {
    let response: object
    try {
      if (!this.options.onRequest) throw new ExternalProtocolError(`Unsupported agent request: ${method}`, -32601)
      const result = await this.options.onRequest(method, params, id)
      response = { id, result: result ?? null }
    } catch (error) {
      const code = error instanceof ExternalProtocolError ? error.code : -32603
      response = { id, error: { code, message: errorMessage(error) } }
    }

    if (this.failure) return
    try {
      this.write(response)
    } catch (error) {
      this.stop(new Error(`Could not respond to the external agent: ${errorMessage(error)}`))
    }
  }

  private stop(error: Error, unexpected = true): void {
    if (this.failure) return
    this.failure = error
    this.lines.close()
    if (unexpected) {
      this.child.stdin.destroy()
      this.child.kill()
    } else {
      // EOF lets the process flush its current conversation and stop its own child processes.
      this.child.stdout.resume()
      this.child.stdin.end()
      const timeout = setTimeout(() => this.child.kill(), EXIT_TIMEOUT_MS)
      timeout.unref()
      this.child.once('close', () => clearTimeout(timeout))
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    if (unexpected) this.options.onClose?.(error)
  }
}
