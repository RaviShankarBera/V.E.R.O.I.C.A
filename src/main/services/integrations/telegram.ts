/**
 * Telegram integration — official Bot API with long polling (no public URL
 * needed, fully inbound/outbound from this PC).
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { IntegrationState } from '../../../shared/types'

export interface ModuleCallbacks {
  onIncoming: (target: string, from: string, fromName: string, text: string) => void
  onStatus: (state: IntegrationState, detail?: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class TelegramModule {
  private controller: AbortController | null = null
  private failures = 0
  received = 0

  constructor(private readonly cb: ModuleCallbacks) {}

  async start(token: string): Promise<void> {
    await this.stop()
    this.controller = new AbortController()
    this.cb.onStatus('starting')
    const signal = this.controller.signal
    let offset = 0
    const api = `https://api.telegram.org/bot${token}`

    while (!signal.aborted) {
      try {
        const res = await fetch(
          `${api}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`,
          { signal }
        )
        const json = (await res.json()) as {
          ok?: boolean
          description?: string
          result?: Array<{
            update_id: number
            message?: {
              chat: { id: number }
              from?: { first_name?: string; username?: string }
              text?: string
            }
          }>
        }
        if (!json.ok) throw new Error(json.description || `HTTP ${res.status}`)
        this.failures = 0
        this.cb.onStatus('connected')
        for (const upd of json.result ?? []) {
          offset = upd.update_id + 1
          const msg = upd.message
          if (!msg?.text) continue
          this.received++
          const from = String(msg.chat.id)
          const name = msg.from?.username || msg.from?.first_name || from
          this.cb.onIncoming(from, from, name, msg.text)
        }
      } catch (err) {
        if (signal.aborted) break
        this.failures++
        this.cb.onStatus('error', (err as Error).message)
        if (this.failures >= 5) {
          await sleep(30_000)
          this.failures = 0
        } else {
          await sleep(4000)
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    this.controller = null
  }

  async send(token: string, chatId: string, text: string): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) })
    })
    const json = (await res.json()) as { ok?: boolean; description?: string }
    if (!json.ok) throw new Error(json.description || `HTTP ${res.status}`)
  }
}
