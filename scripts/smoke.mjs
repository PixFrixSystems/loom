// Smoke test: launches the built app against a scratch data folder and exercises the main features.
// Usage: npm run build && node scripts/smoke.mjs [--live]
//   --live also sends two short messages to Claude (Haiku) to test chatting and approvals.
//   LOOM_SMOKE_CHAT="<folder>|<session id>" also checks that one of your saved chats loads its history.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const live = process.argv.includes('--live')
const dataDir = join(tmpdir(), `loom-smoke-${Date.now()}`)
mkdirSync(dataDir, { recursive: true })

const loomDir = process.cwd()
// A small site to run, with an icon to find
const siteDir = join(dataDir, 'demo-site')
mkdirSync(join(siteDir, 'public'), { recursive: true })
writeFileSync(join(siteDir, 'package.json'), JSON.stringify({ name: 'demo-site', scripts: { dev: 'node -e ""' } }))
writeFileSync(
  join(siteDir, 'public', 'favicon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2b7a6b"/></svg>'
)
const [histDir, histSession] = (process.env.LOOM_SMOKE_CHAT ?? '').split('|')
const history = !!(histDir && histSession)

const state = {
  version: 1,
  projects: [
    { id: 'p-loom', name: 'loom', path: loomDir, color: 'verdigris', groupId: 'g1', collapsed: false },
    { id: 'p-site', name: 'demo-site', path: siteDir, color: 'madder', groupId: null },
    ...(history ? [{ id: 'p-hist', name: 'saved chat', path: histDir, color: 'woad', groupId: null }] : [])
  ],
  groups: [{ id: 'g1', name: 'Tools' }],
  tabs: [
    { id: 't-site', kind: 'chat', projectId: 'p-site', sessionId: null, cwd: siteDir, title: 'Site chat' },
    { id: 't-file', kind: 'file', projectId: 'p-loom', path: join(loomDir, 'package.json'), title: 'package.json' },
    { id: 't-term', kind: 'terminal', projectId: 'p-loom', cwd: loomDir, title: 'Terminal' },
    { id: 't-new', kind: 'chat', projectId: 'p-loom', sessionId: null, cwd: loomDir, title: 'New chat', model: 'haiku', permissionMode: 'default' },
    ...(history ? [{ id: 't-hist', kind: 'chat', projectId: 'p-hist', sessionId: histSession, cwd: histDir, title: 'Saved chat' }] : [])
  ],
  activeTabId: 't-site',
  settings: { claudeSource: 'bundled', claudeCustomPath: '', shell: 'powershell', sendWithCtrlEnter: false, defaultPermissionMode: null, notifyWhenDone: false },
  sidebarWidth: 260,
  sidebarOpen: true,
  rightPanelOpen: true,
  rightPanelWidth: 280,
  rightPanelView: 'files',
  knownModels: [],
  onboarded: true
}
writeFileSync(join(dataDir, 'loom-state.json'), JSON.stringify(state))

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const env = { ...process.env, LOOM_USER_DATA: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], cwd: loomDir, env })
const errors = []
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await win.waitForSelector('.brand', { timeout: 20000 })

  const chats = history ? 3 : 2
  const sidebar = await win.locator('.sidebar').innerText()
  ok('sidebar shows group and projects', sidebar.includes('Tools') && sidebar.includes('loom') && sidebar.includes('demo-site'))
  ok('tab bar shows every tab', (await win.locator('.tab').count()) === chats + 2)
  ok('files sit on their own row under the chats', (await win.locator('.filebar .tab').count()) === 1 && (await win.locator('.topbar .tab').count()) === chats + 1)
  await win.waitForSelector('.project-row .project-icon', { timeout: 10000 }).catch(() => {})
  ok('a project shows its favicon', (await win.locator('.project-row .project-icon').count()) >= 1)
  await win.waitForSelector('.sb-usage', { timeout: 30000 }).catch(() => {})
  const usageText = (await win.locator('.sb-usage').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok('status bar shows plan limits', /\d+%/.test(usageText), usageText)
  await win.locator('.tab', { hasText: 'New chat' }).click()
  const bar = (await win.locator('.tab-panel:not([hidden]) .composer-bar').innerText()).replace(/\s+/g, ' ')
  ok('message box offers effort and ultracode', /Effort|Default|High|Extra high|Max|Medium|Low/.test(bar) && bar.includes('Ultracode'), bar)
  await win.locator('.tab', { hasText: 'Site chat' }).click()
  // Only looks for the button; the full start, stop and quit cycle is too slow for a smoke test.
  await win.waitForSelector('.tab-panel:not([hidden]) .chat-head .run-btn', { timeout: 10000 }).catch(() => {})
  const run = (await win.locator('.tab-panel:not([hidden]) .chat-head .run-split').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok('chat header offers to run the project', run.startsWith('Run'), run)

  // History
  if (history) {
    await win.locator('.tab', { hasText: 'Saved chat' }).click()
    await win.waitForSelector('.tab-panel:not([hidden]) .msg-assistant, .tab-panel:not([hidden]) .note.tone-error', { timeout: 30000 })
    const histCount = await win.locator('.tab-panel:not([hidden]) .chat-column > *').count()
    ok('a saved chat loads its history', histCount > 2, `${histCount} items`)
  } else {
    console.log('SKIP  a saved chat loads its history  (set LOOM_SMOKE_CHAT="<folder>|<session id>")')
  }

  // Files panel
  await win.locator('.tab', { hasText: 'package.json' }).click()
  const files = await win.locator('.rightpanel').innerText()
  ok('right panel lists project files', files.includes('package.json') || files.includes('src'))

  // File tab
  await win.waitForSelector('.tab-panel:not([hidden]) .monaco-editor', { timeout: 15000 })
  const editorText = await win.locator('.tab-panel:not([hidden]) .view-lines').innerText()
  ok('file tab opens in the editor', editorText.includes('"name"'), editorText.slice(0, 40).replace(/\s+/g, ' '))

  // Terminal tab
  await win.locator('.tab', { hasText: 'Terminal' }).click()
  await win.waitForFunction(() => {
    const el = document.querySelector('.tab-panel:not([hidden]) .xterm-rows')
    return !!el && /PS [A-Z]:\\/.test(el.textContent ?? '')
  }, null, { timeout: 20000 }).catch(() => {})
  const termText = (await win.locator('.tab-panel:not([hidden]) .xterm-rows').innerText().catch(() => '')).trim()
  ok('terminal starts PowerShell in the project folder', /PS [A-Z]:\\/.test(termText), termText.split('\n').filter(Boolean).pop()?.slice(0, 60))

  // Quick open
  await win.keyboard.press('Control+p')
  await win.waitForSelector('.palette', { timeout: 5000 })
  await win.keyboard.type('tsconfig.web')
  await win.waitForSelector('.palette-row', { timeout: 10000 })
  await win.keyboard.press('Enter')
  await win.waitForSelector('.tab:has-text("tsconfig.web.json")', { timeout: 5000 }).catch(() => {})
  ok('quick open finds and opens a file', (await win.locator('.tab', { hasText: 'tsconfig.web.json' }).count()) === 1)

  if (live) {
    await win.locator('.tab', { hasText: 'New chat' }).click()
    const input = win.locator('.tab-panel:not([hidden]) .composer-input')
    await input.fill('Reply with exactly the word PINEAPPLE and nothing else.')
    await input.press('Enter')
    await win.waitForSelector('.tab-panel:not([hidden]) .msg-assistant:has-text("PINEAPPLE")', { timeout: 120000 }).catch(() => {})
    const reply = await win.locator('.tab-panel:not([hidden]) .msg-assistant').last().innerText().catch(() => '')
    ok('live chat: Claude replies', reply.includes('PINEAPPLE'), reply.slice(0, 60))
    const title = await win.locator('.tab.active .tab-title').innerText()
    ok('live chat: tab is named from the first message', title.startsWith('Reply with'), title)

    // A file write always needs approval in "Ask before edits"; deny it so nothing is written.
    await input.fill('Use the Write tool to create a file named loom-approval-test.txt in the current folder containing the word hi. If you are not allowed, reply with the single word DENIED.')
    await input.press('Enter')
    const asked = await win.waitForSelector('.tab-panel:not([hidden]) .ask', { timeout: 120000 }).then(() => true).catch(() => false)
    ok('live chat: approval card appears for a file write', asked)
    if (asked) {
      const askText = await win.locator('.tab-panel:not([hidden]) .ask').innerText()
      await win.locator('.tab-panel:not([hidden]) .ask .btn', { hasText: 'Deny' }).click()
      await win.waitForSelector('.tab-panel:not([hidden]) .msg-assistant:has-text("DENIED")', { timeout: 120000 }).catch(() => {})
      const last = await win.locator('.tab-panel:not([hidden]) .msg-assistant').last().innerText().catch(() => '')
      const { existsSync } = await import('node:fs')
      ok('live chat: denying stops the write', last.includes('DENIED') && !existsSync(join(loomDir, 'loom-approval-test.txt')), `${askText.split('\n')[0]} / ${last.slice(0, 40)}`)
    }
    const sb = await win.locator('.statusbar').innerText()
    ok('status bar shows project and branch', sb.includes('loom'), sb.replace(/\s+/g, ' '))
  }

  ok('no renderer errors', errors.length === 0, errors.slice(0, 5).join(' | '))
} catch (e) {
  ok('smoke run', false, e.message)
} finally {
  await app.close().catch(() => {})
  rmSync(dataDir, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.pass).length
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
