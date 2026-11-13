import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { after, mock, test } from 'node:test'

class TestAgent extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false

  constructor() {
    super()
    this.stdin.setEncoding('utf8').on('data', (line) => this.emit('message', JSON.parse(line)))
    this.stdin.on('end', () => this.emit('close', 0, null))
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  kill() {
    this.killed = true
    this.emit('close', null, 'SIGTERM')
  }
}

let agent
mock.method(childProcess, 'spawn', (executable, args) => {
  assert.equal(executable, process.execPath)
  assert.deepEqual(args, ['app-server'])
  return agent
})
syncBuiltinESMExports()
after(() => {
  mock.restoreAll()
  syncBuiltinESMExports()
})

const { ExternalProtocol } = await import('../src/main/externalProtocol.ts')

async function initialize(options = {}) {
  agent = new TestAgent()
  const firstMessage = once(agent, 'message')
  const client = new ExternalProtocol(process.execPath, options)
  const [init] = await firstMessage
  assert.equal(init.method, 'initialize')
  assert.equal(init.params.clientInfo.name, 'loom')
  const handshake = once(agent, 'message')
  agent.send({ id: init.id, result: {} })
  assert.deepEqual(await handshake, [{ method: 'initialized' }])
  return client
}

test('handles a notification and an asynchronous approval during a client request', async () => {
  const notifications = []
  const client = await initialize({
    onNotification: (...notification) => notifications.push(notification),
    async onRequest(method, params, id) {
      assert.equal(method, 'item/commandExecution/requestApproval')
      assert.deepEqual(params, { command: 'echo hello' })
      assert.equal(id, 2)
      return { decision: 'accept' }
    },
  })
  try {
    const outgoing = once(agent, 'message')
    const response = client.request('turn/start', { threadId: 'thread-1' })
    const [turn] = await outgoing
    assert.deepEqual(turn, { id: 2, method: 'turn/start', params: { threadId: 'thread-1' } })
    agent.send({ method: 'turn/started', params: { turnId: 'turn-1' } })
    const approval = once(agent, 'message')
    agent.send({ id: turn.id, method: 'item/commandExecution/requestApproval', params: { command: 'echo hello' } })
    assert.deepEqual(await approval, [{ id: turn.id, result: { decision: 'accept' } }])
    agent.send({ id: turn.id, result: { turnId: 'turn-1' } })
    assert.deepEqual(await response, { turnId: 'turn-1' })
    assert.deepEqual(notifications, [['turn/started', { turnId: 'turn-1' }]])
  } finally {
    client.close()
  }
})

test('closing rejects a pending request and ends the child input', async () => {
  const closed = mock.fn()
  const client = await initialize({ onClose: closed })
  const outgoing = once(agent, 'message')
  const rejected = assert.rejects(client.request('turn/start'), /connection closed/)
  await outgoing
  const childClosed = once(agent, 'close')
  client.close()
  await rejected
  await childClosed
  assert.equal(agent.stdin.writableEnded, true)
  assert.equal(agent.killed, false)
  assert.equal(closed.mock.callCount(), 0)
})

test('a timed-out request closes the connection and rejects pending requests', async (t) => {
  const closed = mock.fn()
  const client = await initialize({ onClose: closed })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const outgoing = once(agent, 'message')
    const first = assert.rejects(client.request('turn/start'), /timed out while handling turn\/start/)
    await outgoing
    const nextOutgoing = once(agent, 'message')
    const second = assert.rejects(client.request('model/list'), /timed out while handling turn\/start/)
    await nextOutgoing
    t.mock.timers.tick(30_000)
    await Promise.all([first, second])
    assert.equal(agent.killed, true)
    assert.equal(closed.mock.callCount(), 1)
  } finally {
    client.close()
  }
})
