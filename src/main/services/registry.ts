/**
 * Service registry — constructs every long-lived service exactly once and
 * exposes the shared tool context used by chat, tasks and integrations.
 * Original work © 2026 Ravi Shankar Bera.
 */
import { BrowserService } from './browser'
import { ChatController } from './chat'
import { ConfirmBroker } from '../confirm'
import { IntegrationHub } from './integrations'
import { KeyStore } from './keys'
import { MemoryService } from './memory'
import { SettingsStore } from './settings'
import { TaskScheduler } from './tasks'
import { VoiceService } from './voice/voice'
import type { ToolContext } from './agent/tools'

export interface AppRegistry {
  settings: SettingsStore
  keys: KeyStore
  memory: MemoryService
  browser: BrowserService
  voice: VoiceService
  integrations: IntegrationHub
  tasks: TaskScheduler
  chat: ChatController
  confirm: ConfirmBroker
  ctxBase: Pick<ToolContext, 'memory' | 'browser' | 'sendIntegration' | 'speak' | 'settings'>
}

export function createRegistry(userDataDir: string): AppRegistry {
  const settings = new SettingsStore(userDataDir)
  const keys = new KeyStore(userDataDir)
  const memory = new MemoryService(userDataDir)
  const browser = new BrowserService(userDataDir)
  const voice = new VoiceService(keys, () => settings.get(), (p) => settings.update(p))

  const ctxBase: AppRegistry['ctxBase'] = {
    memory,
    browser,
    settings: () => settings.get(),
    sendIntegration: (id, target, text) => integrations.send(id, target, text),
    speak: (text) => voice.speak(text)
  }

  const integrations = new IntegrationHub(
    () => settings.get(),
    (p) => settings.update(p),
    keys,
    ctxBase,
    userDataDir
  )

  const confirm = new ConfirmBroker()
  const tasks = new TaskScheduler(memory, () => settings.get(), keys, ctxBase)
  const chat = new ChatController(() => settings.get(), keys, memory, confirm, ctxBase)

  return { settings, keys, memory, browser, voice, integrations, tasks, chat, confirm, ctxBase }
}
