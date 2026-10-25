/**
 * Integration hub — owns the three messaging modules, applies allowlist
 * gating, and routes inbound messages through the headless agent.
 * Security posture: never an open relay. Replies only to explicitly allowed
 * ids, or DMs (Slack), or after the user allowlists the discovered id via
 * the /whoami handshake.
 * Original work © 2026 Ravi Shankar Bera.
 */
import path from 'node:path'
import type {
  AppSettings,
  IntegrationConfigView,
  IntegrationId,
  IntegrationState,
  IntegrationStatus,
  KeyMeta
} from '../../../shared/types'
import { emit } from '../../bus'
import { runHeadless } from '../harness'
import type { KeyStore } from '../keys'
import type { MemoryService } from '../memory'
import type { ToolCtxBase, ToolContext } from '../agent/tools'
import { SlackModule } from './slack'
import { TelegramModule, type ModuleCallbacks } from './telegram'
import { WhatsAppModule } from './whatsapp'

const LABELS: Record<IntegrationId, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp'
}

const KEY_HINTS: Record<IntegrationId, string[]> = {
  telegram: ['integration:telegram'],
  slack: ['integration:slack-app', 'integration:slack-bot'],
  whatsapp: []
}

interface State {
  state: IntegrationState
  detail?: string
  qr?: string
}

export class IntegrationHub {
  private readonly telegram = new TelegramModule({
    onIncoming: (t, f, n, x) => void this.handleIncoming('telegram', t, f, n, x),
    onStatus: (s, d) => this.setStatus('telegram', s, d)
  })
  private readonly slack = new SlackModule({
    onIncoming: (t, f, n, x) => void this.handleIncoming('slack', t, f, n, x),
    onStatus: (s, d) => this.setStatus('slack', s, d)
  })
  private readonly whatsapp: WhatsAppModule
  private states: Record<IntegrationId, State> = {
    telegram: { state: 'disabled' },
    slack: { state: 'disabled' },
    whatsapp: { state: 'disabled' }
  }
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly settings: () => AppSettings,
    private readonly settingsUpdate: (patch: Partial<AppSettings>) => void,
    private readonly keys: KeyStore,
    private readonly base: Omit<ToolCtxBase, 'sendIntegration'>,
    userDataDir: string
  ) {
    this.whatsapp = new WhatsAppModule(path.join(userDataDir, 'whatsapp-auth'), {
      onIncoming: (t, f, n, x) => void this.handleIncoming('whatsapp', t, f, n, x),
      onStatus: (s, d) => {
        // the module reports the QR payload via the detail slot of 'qr'
        if (s === 'qr') this.setStatus('whatsapp', 'qr', undefined, d)
        else this.setStatus('whatsapp', s, d)
      }
    })
  }

  private setStatus(id: IntegrationId, state: IntegrationState, detail?: string, qr?: string): void {
    this.states[id] = { state, detail, qr }
    emit({ type: 'integration.status', integration: id, state, detail })
  }

  private get ctx(): ToolCtxBase {
    return { ...this.base, sendIntegration: (id, target, text) => this.send(id, target, text) }
  }

  /* ------------------------------- control ----------------------------- */

  async startAll(): Promise<void> {
    for (const id of ['telegram', 'slack', 'whatsapp'] as IntegrationId[]) {
      if (this.settings().integrations[id].enabled) await this.startModule(id)
    }
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([this.telegram.stop(), this.slack.stop(), this.whatsapp.stop()])
  }

  private async startModule(id: IntegrationId): Promise<void> {
    try {
      if (id === 'telegram') {
        const token = this.keys.get('integration:telegram')
        if (!token) {
          this.setStatus('telegram', 'error', 'Missing Telegram bot token — add it in Settings → Keys.')
          return
        }
        void this.telegram.start(token)
      } else if (id === 'slack') {
        const appToken = this.keys.get('integration:slack-app')
        const botToken = this.keys.get('integration:slack-bot')
        if (!appToken || !botToken) {
          this.setStatus('slack', 'error', 'Missing Slack app-level or bot token — add both in Settings → Keys.')
          return
        }
        void this.slack.start(appToken, botToken)
      } else {
        void this.whatsapp.start()
      }
    } catch (err) {
      this.setStatus(id, 'error', (err as Error).message)
    }
  }

  async apply(
    id: IntegrationId,
    enabled: boolean,
    respondToAll?: boolean,
    allowed?: string[]
  ): Promise<IntegrationConfigView[]> {
    const current = this.settings().integrations[id]
    const next = {
      ...current,
      enabled,
      respondToAll: respondToAll ?? current.respondToAll,
      allowed: allowed ?? current.allowed
    }
    this.settingsUpdate({ integrations: { ...this.settings().integrations, [id]: next } })
    if (enabled) {
      await this.startModule(id)
    } else {
      if (id === 'telegram') await this.telegram.stop()
      if (id === 'slack') await this.slack.stop()
      if (id === 'whatsapp') await this.whatsapp.stop()
      this.setStatus(id, 'disabled')
    }
    return this.config()
  }

  /* -------------------------------- status ----------------------------- */

  status(): IntegrationStatus[] {
    return (['telegram', 'slack', 'whatsapp'] as IntegrationId[]).map((id) => ({
      id,
      label: LABELS[id],
      state: this.states[id].state,
      detail: this.states[id].detail,
      qr: this.states[id].qr,
      stats: {
        received:
          id === 'telegram' ? this.telegram.received : id === 'slack' ? this.slack.received : this.whatsapp.received,
        replied: this.replied[id]
      }
    }))
  }

  private replied: Record<IntegrationId, number> = { telegram: 0, slack: 0, whatsapp: 0 }

  config(): IntegrationConfigView[] {
    return (['telegram', 'slack', 'whatsapp'] as IntegrationId[]).map((id) => {
      const s = this.settings().integrations[id]
      const keyHints: KeyMeta[] = KEY_HINTS[id].map((kid) => {
        const meta = this.keys.list().find((k) => k.id === kid)
        return (
          meta ?? { id: kid, label: kid, hasKey: !!this.keys.get(kid), hint: undefined }
        )
      })
      return { id, enabled: s.enabled, respondToAll: s.respondToAll, allowed: s.allowed, keyHints }
    })
  }

  /* -------------------------------- send ------------------------------- */

  async send(id: IntegrationId, target: string | undefined, text: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      const cfg = this.settings().integrations[id]
      if (!cfg.enabled) return { ok: false, detail: `${LABELS[id]} integration is disabled.` }
      const to = target || cfg.allowed[0]
      if (!to) {
        return {
          ok: false,
          detail: `No target: add an allowed ${id} id in Integrations (tip: send /whoami to the bot first).`
        }
      }
      if (id === 'telegram') {
        const token = this.keys.get('integration:telegram')
        if (!token) return { ok: false, detail: 'Telegram bot token not set.' }
        await this.telegram.send(token, to, text)
      } else if (id === 'slack') {
        await this.slack.send(to, text)
      } else {
        await this.whatsapp.send(to, text)
      }
      this.replied[id]++
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: (err as Error).message }
    }
  }

  /* ------------------------------ inbound ------------------------------ */

  private gate(id: IntegrationId, from: string, text: string): 'allow' | 'whoami' | 'ignore' {
    const s = this.settings().integrations[id]
    if (!s.enabled) return 'ignore'
    if (s.respondToAll) return 'allow'
    if (s.allowed.includes(from)) return 'allow'
    if (s.allowed.length === 0 && text.trim().toLowerCase() === '/whoami') return 'whoami'
    if (id === 'slack' && s.allowed.length === 0 && from.startsWith('D')) return 'allow' // Slack DMs are opt-in by nature
    return 'ignore'
  }

  private handleIncoming(id: IntegrationId, target: string, from: string, fromName: string, text: string): void {
    const decision = this.gate(id, from, text)
    if (decision === 'ignore') return
    const prev = this.queues.get(target) ?? Promise.resolve()
    const next = prev
      .then(() => (decision === 'whoami' ? this.replyWhoami(id, target, from) : this.replyAgent(id, target, fromName, text)))
      .catch((err: Error) => {
        emit({ type: 'toast', level: 'error', text: `${LABELS[id]}: ${err.message}` })
      })
    this.queues.set(target, next)
  }

  private async replyWhoami(id: IntegrationId, target: string, from: string): Promise<void> {
    const res = await this.send(
      id,
      target,
      `Your ${LABELS[id]} id is:\n${from}\n\nAdd it under Veronica → Integrations → ${LABELS[id]} → allowed ids, then just message me again.`
    )
    if (res.ok) this.replied[id]++
  }

  private async replyAgent(id: IntegrationId, target: string, fromName: string, text: string): Promise<void> {
    const s = this.settings()
    const reply = await runHeadless(
      text,
      {
        settings: s,
        keys: this.keys,
        providerId: s.chat.defaultProviderId,
        model: s.chat.defaultModel,
        useTools: true,
        systemPrompt:
          `${s.chat.systemPrompt}\n` +
          `You are currently replying inside a ${LABELS[id]} conversation with ${fromName}. ` +
          'Write plain text only (no markdown, no headers), keep it short and conversational.'
      },
      this.ctx
    )
    const res = await this.send(id, target, reply)
    if (!res.ok) throw new Error(res.detail ?? 'send failed')
    this.replied[id]++
    emit({ type: 'integration.message', integration: id, from: fromName, text, reply })
  }
}
