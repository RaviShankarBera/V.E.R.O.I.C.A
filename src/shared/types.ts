/**
 * Veronica AI — shared IPC contract and domain types.
 * Original work © 2026 Ravi Shankar Bera. MIT licensed.
 */

export const IPC_REQUEST = 'veronica:request'
export const IPC_EVENT = 'veronica:event'
export const IPC_PCM = 'veronica:pcm'

/* ------------------------------- events ------------------------------- */

export type AppEvent =
  | { type: 'chat.delta'; sessionId: number; step: number; delta: string }
  | { type: 'chat.tool'; sessionId: number; step: number; phase: 'start' | 'result'; name: string; detail: string }
  | { type: 'chat.done'; sessionId: number; messageId: number }
  | { type: 'chat.error'; sessionId: number; error: string }
  | { type: 'agent.progress'; runId: string; stage: 'start' | 'tool' | 'final'; detail?: string }
  | { type: 'agent.confirm'; confirmId: string; tool: string; args: unknown; summary: string }
  | { type: 'integration.status'; integration: IntegrationId; state: IntegrationState; detail?: string }
  | { type: 'integration.message'; integration: IntegrationId; from: string; text: string; reply?: string }
  | { type: 'task.update'; taskId: number }
  | { type: 'voice.wake'; keyword: string }
  | { type: 'voice.transcript'; text: string }
  | { type: 'voice.status'; state: 'off' | 'starting' | 'listening' | 'error'; detail?: string }
  | { type: 'toast'; level: 'info' | 'error'; text: string }

/* ------------------------------ settings ------------------------------ */

export type IntegrationId = 'telegram' | 'slack' | 'whatsapp'
export type IntegrationState =
  | 'disabled'
  | 'starting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'qr'
  | 'unauthorized'

export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  kind: 'openai-compatible'
  models: string[]
  /** true when a key must be supplied by the user (BYOK) */
  byok: boolean
}

export interface IntegrationSettings {
  telegram: { enabled: boolean; allowed: string[]; respondToAll: boolean }
  slack: { enabled: boolean; allowed: string[]; respondToAll: boolean }
  whatsapp: { enabled: boolean; allowed: string[]; respondToAll: boolean }
}

export interface AppSettings {
  general: { launchAtLogin: boolean }
  chat: {
    defaultProviderId: string
    defaultModel: string
    temperature: number
    systemPrompt: string
    historyLimit: number
  }
  /** Provider endpoints (keys live in the OS-encrypted key store, never here). */
  providers: ProviderConfig[]
  memory: { enabled: boolean; autoCapture: boolean }
  monitor: { refreshMs: number }
  browser: { headless: boolean; channel: 'msedge' | 'chrome' }
  agent: { maxSteps: number; toolConfirmations: boolean }
  voice: {
    wakeEnabled: boolean
    wakeWord: string
    autoSendTranscript: boolean
    sttProviderId: string
    sttModel: string
    ttsVoice: string
    ttsRate: number
  }
  integrations: IntegrationSettings
}

export const WAKE_WORD_CHOICES = [
  'Computer',
  'Jarvis',
  'Alexa',
  'Bumblebee',
  'Blueberry',
  'Americanos',
  'Grapefruit',
  'Grasshopper',
  'Hey Google',
  'Hey Siri',
  'Ok Google',
  'Porcupine',
  'Picovoice',
  'Terminator'
] as const

/* -------------------------------- keys -------------------------------- */

export interface KeyMeta {
  id: string
  label: string
  hasKey: boolean
  hint?: string
}

/* -------------------------------- chat -------------------------------- */

export interface ChatSession {
  id: number
  title: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: number
  sessionId: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** JSON-encoded tool call trace for assistant messages */
  tools?: string | null
  createdAt: number
}

export interface SendChatOptions {
  sessionId: number
  providerId: string
  model: string
  text: string
  useTools: boolean
}

/* ------------------------------- memory ------------------------------- */

export interface MemoryItem {
  id: number
  text: string
  tags: string
  createdAt: number
  source: string
}

export interface MemoryStatus {
  enabled: boolean
  count: number
  killSwitchActive: boolean
  killSwitchPath: string
  dbPath: string
}

/* ------------------------------- monitor ------------------------------ */

export interface MonitorSnapshot {
  cpu: { load: number; cores: number; speed: number }
  mem: { total: number; used: number; free: number; swapUsed: number }
  disks: Array<{ fs: string; type: string; size: number; used: number; mount: string }>
  uptime: number
  procs: number
  at: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  mem: number
  started?: string
  user?: string
  protected?: boolean
}

/* ------------------------------- browser ------------------------------ */

export interface BrowserState {
  running: boolean
  url: string | null
  title: string | null
  headless: boolean
  lastAction?: string
}

export interface BrowserReadResult {
  url: string
  title: string
  text: string
  truncated: boolean
}

/* -------------------------------- tasks ------------------------------- */

export interface AgenticTask {
  id: number
  title: string
  prompt: string
  /** 'once' | 'interval' | 'cron' */
  scheduleKind: string
  schedule: string
  status: 'paused' | 'scheduled' | 'running' | 'done' | 'error'
  providerId: string
  model: string
  lastRunAt: number | null
  lastResult: string | null
  nextRunAt: number | null
  createdAt: number
}

export interface TaskRun {
  id: number
  taskId: number
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'ok' | 'error'
  output: string
}

/* ---------------------------- integrations ---------------------------- */

export interface IntegrationStatus {
  id: IntegrationId
  label: string
  state: IntegrationState
  detail?: string
  qr?: string
  stats: { received: number; replied: number }
}

export interface IntegrationConfigView {
  id: IntegrationId
  enabled: boolean
  respondToAll: boolean
  allowed: string[]
  keyHints: KeyMeta[]
}

/* -------------------------------- voice ------------------------------- */

export interface VoiceStatus {
  wakeEnabled: boolean
  workerState: 'off' | 'starting' | 'listening' | 'error'
  accessKeySet: boolean
  wakeWord: string
  detail?: string
}

/* ------------------------------- providers ---------------------------- */

export interface ChatToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatResult {
  content: string
  toolCalls: ChatToolCall[]
  finishReason: string
}

/* ------------------------------ IPC methods --------------------------- */

export interface MethodMap {
  // app
  'app.info': { req: void; res: { version: string; userData: string; platform: string } }

  // settings & keys
  'settings.get': { req: void; res: AppSettings }
  'settings.set': { req: Partial<AppSettings>; res: AppSettings }
  'keys.list': { req: void; res: KeyMeta[] }
  'keys.set': { req: { id: string; value: string }; res: KeyMeta }
  'keys.delete': { req: { id: string }; res: void }

  // chat
  'chat.sessions': { req: void; res: ChatSession[] }
  'chat.create': { req: { title?: string } | void; res: ChatSession }
  'chat.delete': { req: { id: number }; res: void }
  'chat.history': { req: { sessionId: number }; res: ChatMessage[] }
  'chat.send': { req: SendChatOptions; res: { ok: true } }
  'chat.abort': { req: { sessionId: number }; res: void }

  // agent (one-shot runs used by integrations/tasks/testing)
  'agent.run': {
    req: { prompt: string; providerId: string; model: string; useTools: boolean; runId: string }
    res: { ok: true }
  }
  'agent.respond': { req: { confirmId: string; approved: boolean }; res: void }

  // memory
  'memory.status': { req: void; res: MemoryStatus }
  'memory.search': { req: { query: string; limit?: number }; res: MemoryItem[] }
  'memory.list': { req: { limit?: number }; res: MemoryItem[] }
  'memory.add': { req: { text: string; tags?: string; source?: string }; res: MemoryItem }
  'memory.delete': { req: { id: number }; res: void }
  'memory.setKillSwitch': { req: { active: boolean }; res: MemoryStatus }

  // monitor
  'monitor.snapshot': { req: void; res: MonitorSnapshot }
  'monitor.processes': { req: { filter?: string }; res: ProcessInfo[] }
  'monitor.kill': { req: { pid: number }; res: { ok: boolean; reason?: string } }

  // browser
  'browser.open': { req: { url: string; headless?: boolean }; res: BrowserState }
  'browser.close': { req: void; res: BrowserState }
  'browser.state': { req: void; res: BrowserState }
  'browser.read': { req: void; res: BrowserReadResult }
  'browser.screenshot': { req: void; res: { dataUrl: string; path: string } }
  'browser.act': {
    req: { action: 'click' | 'type' | 'scroll'; selector: string; text?: string }
    res: { ok: boolean; detail: string }
  }

  // tasks
  'tasks.list': { req: void; res: AgenticTask[] }
  'tasks.create': {
    req: {
      title: string
      prompt: string
      scheduleKind: string
      schedule: string
      providerId: string
      model: string
    }
    res: AgenticTask
  }
  'tasks.update': { req: { id: number; patch: Partial<AgenticTask> }; res: AgenticTask }
  'tasks.delete': { req: { id: number }; res: void }
  'tasks.runNow': { req: { id: number }; res: void }
  'tasks.runs': { req: { taskId: number }; res: TaskRun[] }

  // integrations
  'integrations.status': { req: void; res: IntegrationStatus[] }
  'integrations.config': { req: void; res: IntegrationConfigView[] }
  'integrations.apply': {
    req: {
      id: IntegrationId
      enabled: boolean
      respondToAll?: boolean
      allowed?: string[]
    }
    res: IntegrationConfigView[]
  }
  'integrations.send': {
    req: { id: IntegrationId; target: string; text: string }
    res: { ok: boolean; detail?: string }
  }

  // voice
  'voice.status': { req: void; res: VoiceStatus }
  'voice.setWake': { req: { enabled: boolean; wakeWord?: string }; res: VoiceStatus }
  'voice.transcribe': { req: { audioBase64: string; mime: string }; res: { text: string } }
  'voice.speak': { req: { text: string }; res: { ok: boolean } }
  'voice.stopSpeaking': { req: void; res: void }
}

export type MethodName = keyof MethodMap

export interface RequestEnvelope {
  method: string
  payload: unknown
}

export type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

/* preload surface exposed as window.veronica */
export interface VeronicaApi {
  request<K extends MethodName>(
    method: K,
    payload: MethodMap[K]['req']
  ): Promise<ResponseEnvelope<MethodMap[K]['res']>>
  sendPcm(data: ArrayBuffer): void
  onEvent(cb: (evt: AppEvent) => void): () => void
}
