import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { ConfigFileInfo } from '@shared/types'

interface AgentProfile {
  name: string
  accountName: string
  loginType?: string
  loginOrigins?: string[]
  installUrl?: string
  executable?: string
  installDirectory?: string
  configHomeDirectory?: string
  configHomeEnv?: string
}

function readProfile(): AgentProfile {
  const file = app.isPackaged ? join(process.resourcesPath, 'agent-profile.json') : process.env.LOOM_AGENT_PROFILE
  if (file) {
    try {
      const profile = JSON.parse(readFileSync(file, 'utf8')) as AgentProfile
      if (typeof profile.name === 'string' && typeof profile.accountName === 'string') return profile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[agent profile]', error)
    }
  }
  return { name: 'External agent', accountName: 'External agent' }
}

export const agentProfile = readProfile()

export const externalBrand = {
  name: agentProfile.name,
  accountName: agentProfile.accountName,
  installUrl: agentProfile.installUrl,
  loginSupported: !!agentProfile.loginType && !!agentProfile.loginOrigins?.length
}

function installedProgram(root: string, executable: string): string | undefined {
  const direct = join(root, executable)
  if (existsSync(direct)) return direct
  try {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, executable))
      .flatMap((file) => {
        try {
          const info = statSync(file)
          return info.isFile() ? [{ file, modified: info.mtimeMs }] : []
        } catch {
          return []
        }
      })
    return versions.sort((a, b) => b.modified - a.modified)[0]?.file
  } catch {
    return undefined
  }
}

export function externalProgram(configured?: string): string {
  const selection = configured?.trim()
  if (selection) return selection
  const { executable, installDirectory } = agentProfile
  if (!executable) return ''
  if (installDirectory) {
    for (const local of new Set([process.env.LOCALAPPDATA, join(app.getPath('home'), 'AppData', 'Local')])) {
      const found = local && installedProgram(join(local, installDirectory), executable)
      if (found) return found
    }
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, '')
    if (!isAbsolute(directory)) continue
    const found = join(directory, executable)
    if (existsSync(found)) return found
  }
  return ''
}

export function externalConfigFiles(project: string | null): ConfigFileInfo[] {
  const { configHomeDirectory, configHomeEnv } = agentProfile
  const override = configHomeEnv && process.env[configHomeEnv]
  const home = override && isAbsolute(override) ? override : configHomeDirectory && join(app.getPath('home'), configHomeDirectory)
  const files: Omit<ConfigFileInfo, 'exists'>[] = []
  if (home) files.push(
    { label: 'AGENTS.md', path: join(home, 'AGENTS.md'), scope: 'global' },
    { label: 'Settings', path: join(home, 'config.toml'), scope: 'global' }
  )
  if (project) {
    files.push({ label: 'AGENTS.md', path: join(project, 'AGENTS.md'), scope: 'project' })
    if (configHomeDirectory) files.push({ label: 'Settings', path: join(project, configHomeDirectory, 'config.toml'), scope: 'project' })
  }
  return files.map((file) => ({ ...file, exists: existsSync(file.path) }))
}
