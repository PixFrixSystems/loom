import type { WebContents } from 'electron'
import type { ChatStartOptions, LoomSettings } from '@shared/types'
import { ChatSession } from './claude'
import { externalProgram } from './externalAgent'
import { ExternalChatSession } from './externalSession'

const chats = new Map<string, ChatSession | ExternalChatSession>()

export function openChat(
  web: WebContents,
  tabId: string,
  opts: ChatStartOptions,
  settings: () => LoomSettings,
  onTurnDone: (tabId: string, error?: string, ask?: string) => void
): void {
  const existing = chats.get(tabId)
  if (existing) {
    existing.rebind(web)
    return
  }
  const chat = opts.provider === 'external'
    ? new ExternalChatSession(web, tabId, opts, () => externalProgram(settings().externalProgram), onTurnDone)
    : new ChatSession(web, tabId, opts, settings, onTurnDone)
  chats.set(tabId, chat)
}

/** Starts holding a chat's events while its tab moves to another window. */
export function holdChat(tabId: string): void {
  chats.get(tabId)?.hold()
}

/** Sends a chat's events to another window, when its tab moves there. */
export function rebindChat(tabId: string, web: WebContents): void {
  chats.get(tabId)?.rebind(web)
}

export function getChat(tabId: string): ChatSession | ExternalChatSession | undefined {
  return chats.get(tabId)
}

export async function backgroundChatTool(tabId: string, toolUseId: string): Promise<{ ok: boolean; message?: string }> {
  const chat = chats.get(tabId)
  if (chat instanceof ChatSession) return chat.background(toolUseId)
  return { ok: false, message: chat ? 'This agent does not support background tasks.' : 'This chat is not running.' }
}

export function stopChatTask(tabId: string, taskId: string): void {
  const chat = chats.get(tabId)
  if (chat instanceof ChatSession) chat.stopTask(taskId)
}

export function closeChat(tabId: string): void {
  chats.get(tabId)?.close()
  chats.delete(tabId)
}

/** Let subsequent Claude turns use the new account. */
export function releaseIdleClaudeChats(): void {
  for (const chat of chats.values()) if (chat instanceof ChatSession) chat.release()
}

export function releaseExternalChats(): void {
  for (const chat of chats.values()) if (chat instanceof ExternalChatSession) chat.releaseAfterTurn()
}

export function closeAllChats(): void {
  for (const id of [...chats.keys()]) closeChat(id)
}

export function liveClaudeQuery(): ChatSession['query'] {
  for (const chat of chats.values()) if (chat instanceof ChatSession && chat.query) return chat.query
  return null
}

export function runningChats(): number {
  return [...chats.values()].filter((chat) => chat.running).length
}
