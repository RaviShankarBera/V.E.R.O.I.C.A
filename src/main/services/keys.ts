/**
 * BYOK key store — API keys and bot tokens encrypted with the OS credential
 * store (Windows DPAPI via Electron safeStorage). Keys are never written to
 * settings.json, never sent to the renderer in plaintext (only masked hints),
 * and never leave the machine except as Authorization headers to the provider
 * endpoint the user configured.
 * Original work © 2026 Ravi Shankar Bera.
 */
import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { KeyMeta } from '../../shared/types'

const LABELS: Record<string, { label: string; hint?: string }> = {
  'provider:openai': { label: 'OpenAI API key' },
  'provider:groq': { label: 'Groq API key' },
  'provider:openrouter': { label: 'OpenRouter API key' },
  'provider:google': { label: 'Google AI API key' },
  'provider:kimi': { label: 'Kimi / Moonshot API key' },
  'provider:deepseek': { label: 'DeepSeek API key' },
  'provider:custom': { label: 'Custom provider API key' },
  'integration:telegram': { label: 'Telegram bot token (@BotFather)' },
  'integration:slack-app': { label: 'Slack app-level token (xapp-…)' },
  'integration:slack-bot': { label: 'Slack bot token (xoxb-…)' },
  'voice:picovoice': { label: 'Picovoice AccessKey (free at console.picovoice.ai)' }
}

function mask(value: string): string {
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export class KeyStore {
  private readonly file: string
  private readonly secrets = new Map<string, string>()
  encrypted = false

  constructor(dir: string) {
    this.file = path.join(dir, 'keys.bin')
  }

  /** Async init: resolve OS-encryption availability, then decrypt existing store. */
  async init(): Promise<void> {
    try {
      this.encrypted = await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      this.encrypted = safeStorage.isEncryptionAvailable()
    }
    this.load()
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file)
      const parsed: unknown = JSON.parse(
        this.encrypted ? safeStorage.decryptString(raw) : raw.toString('utf8')
      )
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') this.secrets.set(k, v)
        }
      }
    } catch {
      /* first run */
    }
  }

  private persist(): void {
    const json = JSON.stringify(Object.fromEntries(this.secrets))
    const data = this.encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, this.file)
  }

  get(id: string): string | undefined {
    return this.secrets.get(id)
  }

  set(id: string, value: string): KeyMeta {
    const trimmed = value.trim()
    if (!trimmed) this.secrets.delete(id)
    else this.secrets.set(id, trimmed)
    this.persist()
    return this.meta(id)
  }

  delete(id: string): void {
    this.secrets.delete(id)
    this.persist()
  }

  private meta(id: string): KeyMeta {
    const value = this.secrets.get(id)
    const info = LABELS[id] ?? { label: id }
    return {
      id,
      label: info.label,
      hasKey: !!value,
      hint: value ? mask(value) : undefined
    }
  }

  list(extraLabels: Array<{ id: string; label: string }> = []): KeyMeta[] {
    const ids = new Set([...Object.keys(LABELS), ...this.secrets.keys(), ...extraLabels.map((e) => e.id)])
    const out: KeyMeta[] = []
    for (const id of ids) {
      const extra = extraLabels.find((e) => e.id === id)
      out.push(extra ? { ...this.meta(id), label: extra.label } : this.meta(id))
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }
}
