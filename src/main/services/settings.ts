/**
 * Settings store — typed JSON config in the app data directory.
 * API keys are NEVER stored here (see keys.ts — OS-encrypted store).
 * Original work © 2026 Ravi Shankar Bera.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, ProviderConfig } from '../../shared/types'

export const PRESET_PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    kind: 'openai-compatible',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    byok: true
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    kind: 'openai-compatible',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    byok: true
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    kind: 'openai-compatible',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'],
    byok: true
  },
  {
    id: 'google',
    label: 'Google Gemini (OpenAI compat)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'openai-compatible',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    byok: true
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    kind: 'openai-compatible',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-8k'],
    byok: true
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    kind: 'openai-compatible',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    byok: true
  }
]

export const DEFAULT_SETTINGS: AppSettings = {
  general: { launchAtLogin: false },
  chat: {
    defaultProviderId: 'groq',
    defaultModel: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    systemPrompt:
      'You are Veronica, a precise and friendly desktop AI assistant running locally on the user\'s PC. ' +
      'Be concise and practical. Use the tools available to you when they help answer the question.',
    historyLimit: 40
  },
  providers: PRESET_PROVIDERS,
  memory: { enabled: true, autoCapture: true },
  monitor: { refreshMs: 3000 },
  browser: { headless: true, channel: 'msedge' },
  agent: { maxSteps: 8, toolConfirmations: true },
  voice: {
    wakeEnabled: false,
    wakeWord: 'Computer',
    autoSendTranscript: true,
    sttProviderId: 'groq',
    sttModel: 'whisper-large-v3-turbo',
    ttsVoice: '',
    ttsRate: 0
  },
  integrations: {
    telegram: { enabled: false, allowed: [], respondToAll: false },
    slack: { enabled: false, allowed: [], respondToAll: false },
    whatsapp: { enabled: false, allowed: [], respondToAll: false }
  }
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : (patch as T)
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const old = out[k]
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      old !== null &&
      typeof old === 'object' &&
      !Array.isArray(old)
    ) {
      out[k] = deepMerge(old, v)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export class SettingsStore {
  private settings: AppSettings
  private readonly file: string
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    this.file = path.join(dir, 'settings.json')
    fs.mkdirSync(dir, { recursive: true })
    let loaded: unknown = null
    try {
      loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      /* first run or corrupt file: fall back to defaults */
    }
    this.settings = loaded ? deepMerge(DEFAULT_SETTINGS, loaded) : structuredClone(DEFAULT_SETTINGS)
    // Always keep preset endpoints available (user may have customized models).
    const known = new Set(this.settings.providers.map((p) => p.id))
    for (const p of PRESET_PROVIDERS) if (!known.has(p.id)) this.settings.providers.push(p)
  }

  get(): AppSettings {
    return this.settings
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = deepMerge(this.settings, patch)
    this.persist()
    return this.settings
  }

  private persist(): void {
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2))
    fs.renameSync(tmp, this.file)
  }
}
