/**
 * Slack integration — Socket Mode (no public webhook; app-level token) with
 * chat.postMessage for replies.
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { IntegrationState } from '../../../shared/types'
import type { ModuleCallbacks } from './telegram'

type SocketClient = {
  start: () => Promise<void>
  destroy: () => Promise<void>
  on: (event: string, cb: (payload: unknown) => void) => void
}
type SlackWeb = { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } }

export class SlackModule {
  private client: SocketClient | null = null
  private web: SlackWeb | null = null
  received = 0

  constructor(private readonly cb: ModuleCallbacks) {}

  async start(appToken: string, botToken: string): Promise<void> {
    await this.stop()
    this.cb.onStatus('starting')
    try {
      const socket = (await import('@slack/socket-mode')) as unknown as {
        SocketModeClient: new (o: { appToken: string }) => SocketClient
      }
      const webapi = (await import('@slack/web-api')) as unknown as {
        WebClient: new (t: string) => SlackWeb
      }
      const client = new socket.SocketModeClient({ appToken })
      this.web = new webapi.WebClient(botToken)
      if (!client) throw new Error('Slack SocketModeClient unavailable')

      client.on('events_api', (payload: unknown) => {
        const p = payload as {
          ack?: () => void
          body?: {
            event?: {
              type?: string
              subtype?: string
              channel?: string
              user?: string
              text?: string
              thread_ts?: string
            }
          }
        }
        try {
          p.ack?.()
        } catch {
          /* ack may already be consumed */
        }
        const ev = p.body?.event
        if (!ev?.channel || !ev.user) return
        const isMessage = ev.type === 'message' && !ev.subtype
        const isMention = ev.type === 'app_mention'
        if (!isMessage && !isMention) return
        const text = (ev.text ?? '').replace(/<@[^>]+>/g, '').trim()
        if (!text) return
        this.received++
        this.cb.onIncoming(ev.channel, ev.user, ev.user, text)
      })
      client.on('error', (err: unknown) => {
        this.cb.onStatus('error', (err as Error)?.message ?? 'slack socket error')
      })

      this.client = client
      await client.start()
      this.cb.onStatus('connected')
    } catch (err) {
      this.cb.onStatus('error', (err as Error).message)
      throw err
    }
  }

  async stop(): Promise<void> {
    const c = this.client
    this.client = null
    this.web = null
    if (c) {
      try {
        await c.destroy()
      } catch {
        /* ignore */
      }
    }
  }

  async send(channel: string, text: string, threadTs?: string): Promise<void> {
    if (!this.web) throw new Error('Slack is not connected.')
    await this.web.chat.postMessage({
      channel,
      text: text.slice(0, 3500),
      ...(threadTs ? { thread_ts: threadTs } : {})
    })
  }
}
