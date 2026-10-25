/**
 * WhatsApp integration — QR pairing via Baileys (WhatsApp Web protocol from
 * this PC, no cloud account). Personal-use only; see README for the ToS note.
 * Original work © 2026 Ravi Shankar Bera.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { IntegrationState } from '../../../shared/types'
import type { ModuleCallbacks } from './telegram'

type Sock = {
  ev: {
    on: (e: string, cb: (arg: never) => void) => void
  }
  sendMessage: (jid: string, content: Record<string, unknown>) => Promise<unknown>
}

export class WhatsAppModule {
  private sock: Sock | null = null
  private stopped = false
  received = 0

  constructor(
    private readonly authDir: string,
    private readonly cb: ModuleCallbacks
  ) {}

  async start(): Promise<void> {
    await this.stop()
    this.stopped = false
    this.cb.onStatus('starting')
    try {
      fs.mkdirSync(this.authDir, { recursive: true })
      const mod = (await import('@whiskeysockets/baileys')) as Record<string, unknown>
      const makeWASocket = (mod['makeWASocket'] ?? mod['default']) as (o: Record<string, unknown>) => Sock
      const useMultiFileAuthState = mod['useMultiFileAuthState'] as (d: string) => Promise<{
        state: unknown
        saveCreds: () => Promise<void>
      }>
      if (!makeWASocket || !useMultiFileAuthState) {
        throw new Error('Baileys exports not found (version mismatch).')
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Veronica AI', 'Chrome', '1.0.0']
      })
      this.sock = sock

      sock.ev.on('creds.update', (() => void saveCreds()) as never)
      sock.ev.on('connection.update', ((update: {
        qr?: string
        connection?: string
        lastDisconnect?: { error?: { output?: { statusCode?: number } } }
      }) => {
        if (this.stopped) return
        if (update.qr) this.cb.onStatus('qr', update.qr)
        if (update.connection === 'open') this.cb.onStatus('connected')
        if (update.connection === 'close') {
          const code = update.lastDisconnect?.error?.output?.statusCode
          const loggedOut = code === 401
          this.cb.onStatus(loggedOut ? 'disconnected' : 'error', loggedOut ? 'logged out — pair again' : `code ${code ?? '?'}`)
        }
      }) as never)
      sock.ev.on('messages.upsert', ((payload: {
        type?: string
        messages?: Array<{
          key: { remoteJid?: string | null; fromMe?: boolean }
          pushName?: string
          message?: Record<string, unknown> | null
        }>
      }) => {
        if (payload.type !== 'notify') return
        for (const m of payload.messages ?? []) {
          if (m.key.fromMe || !m.key.remoteJid) continue
          const jid = m.key.remoteJid
          if (jid.includes('status@broadcast')) continue
          const text = extractText(m.message)
          if (!text) continue
          this.received++
          this.cb.onIncoming(jid, jid, m.pushName || jid, text)
        }
      }) as never)
    } catch (err) {
      this.cb.onStatus('error', (err as Error).message)
      throw err
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.sock = null
    // Baileys sockets close themselves when the reference drops; keep auth state.
  }

  async send(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp is not connected (pair via QR first).')
    await this.sock.sendMessage(jid, { text: text.slice(0, 4000) })
  }
}

function extractText(message: Record<string, unknown> | null | undefined): string {
  if (!message) return ''
  const conv = message['conversation']
  if (typeof conv === 'string') return conv
  const ext = message['extendedTextMessage'] as { text?: string } | undefined
  if (ext?.text) return ext.text
  const cap =
    (message['imageMessage'] as { caption?: string } | undefined)?.caption ??
    (message['videoMessage'] as { caption?: string } | undefined)?.caption ??
    (message['documentMessage'] as { caption?: string } | undefined)?.caption
  return cap ?? ''
}
