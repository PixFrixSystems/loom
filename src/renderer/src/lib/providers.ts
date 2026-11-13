import type { ChatProvider, PermissionMode } from '@shared/types'

export const EXTERNAL_AGENT = 'External agent'

export function agentName(provider: ChatProvider | undefined, externalName: string): string {
  return provider === 'external' ? externalName : 'Claude'
}

export function chatProviders(externalName: string): { value: ChatProvider; label: string }[] {
  return [{ value: 'claude', label: 'Claude Code' }, { value: 'external', label: externalName }]
}

export const EXTERNAL_MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'Read-only', description: 'Ask before running commands outside read-only access' },
  { value: 'acceptEdits', label: 'Edit workspace', description: 'Allow edits in this workspace and ask for access beyond it' },
  { value: 'plan', label: 'Plan mode', description: 'Explore and propose a plan without editing files' }
]

export function externalPermissionMode(mode?: PermissionMode | null): PermissionMode {
  return mode && EXTERNAL_MODE_OPTIONS.some((option) => option.value === mode) ? mode : 'default'
}

export function sessionKey(session: { sessionId: string | null; provider?: ChatProvider }): string {
  return session.provider === 'external' ? `external:${session.sessionId}` : session.sessionId ?? ''
}
