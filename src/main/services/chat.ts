/**
 * Chat controller — persists sessions/transcripts, streams deltas with step
 * tags (renderer resets its buffer when the harness advances a step), and
 * records the tool trace on the assistant message.
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { AppSettings, SendChatOptions } from '../../shared/types'
import { emit } from '../bus'
import type { ConfirmBroker } from '../confirm'
import { runHarness } from './harness'
import type { KeyStore } from './keys'
import type { MemoryService } from './memory'
import type { ToolContext } from './agent/tools'
import type { OutgoingMessage } from './providers'

export class ChatController {
  private readonly aborts = new Map<number, AbortController>()

  constructor(
    private readonly settings: () => AppSettings,
    private readonly keys: KeyStore,
    private readonly memory: MemoryService,
    private readonly confirm: ConfirmBroker,
    private readonly ctxBase: Pick<ToolContext, 'memory' | 'browser' | 'sendIntegration' | 'speak' | 'settings'>
  ) {}

  async send(opts: SendChatOptions): Promise<void> {
    this.abort(opts.sessionId)
    const controller = new AbortController()
    this.aborts.set(opts.sessionId, controller)

    try {
      const s = this.settings()
      const provider = s.providers.find((p) => p.id === opts.providerId)
      if (!provider) throw new Error(`Unknown provider "${opts.providerId}".`)
      if (!this.keys.get(`provider:${opts.providerId}`)) {
        throw new Error(`No API key stored for ${provider.label} — add it in Settings → Keys.`)
      }

      const text = opts.text.trim()
      if (!text) return

      // persist user turn + auto-title fresh sessions
      this.memory.addMessage(opts.sessionId, 'user', text)
      const sessions = this.memory.listSessions(100)
      const session = sessions.find((x) => x.id === opts.sessionId)
      if (session && session.title === 'New chat') {
        this.memory.renameSession(opts.sessionId, text.slice(0, 48) + (text.length > 48 ? '…' : ''))
      }

      // build history (before this turn), system/user/assistant only
      const prior = this.memory
        .history(opts.sessionId, s.chat.historyLimit)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1) // drop the just-persisted user message (harness appends it)
      const history: OutgoingMessage[] = prior.map((m) => ({ role: m.role, content: m.content }))

      if (s.memory.enabled && s.memory.autoCapture) {
        this.memory.addMemory(text, '', 'chat')
      }

      const result = await runHarness(
        {
          settings: s,
          keys: this.keys,
          providerBaseUrl: provider.baseUrl,
          providerId: opts.providerId,
          model: opts.model,
          systemPrompt: s.chat.systemPrompt,
          history,
          userText: text,
          useTools: opts.useTools,
          signal: controller.signal,
          confirm: (tool, args, summary) => this.confirm.request(tool, args, summary),
          onDelta: (step, delta) => emit({ type: 'chat.delta', sessionId: opts.sessionId, step, delta }),
          onToolStart: (step, name, args) =>
            emit({
              type: 'chat.tool',
              sessionId: opts.sessionId,
              step,
              phase: 'start',
              name,
              detail: JSON.stringify(args).slice(0, 300)
            }),
          onToolResult: (step, name, res) =>
            emit({
              type: 'chat.tool',
              sessionId: opts.sessionId,
              step,
              phase: 'result',
              name,
              detail: res.slice(0, 300)
            })
        },
        this.ctxBase
      )

      if (result.error === 'aborted') {
        emit({ type: 'chat.error', sessionId: opts.sessionId, error: 'Stopped.' })
        return
      }

      const finalText = result.text || result.error || '(no response)'
      const tools =
        result.toolTrace.length > 0
          ? { steps: result.steps, trace: result.toolTrace, error: result.error }
          : result.error
            ? { steps: result.steps, trace: [], error: result.error }
            : undefined
      const messageId = this.memory.addMessage(opts.sessionId, 'assistant', finalText, tools)
      emit({ type: 'chat.done', sessionId: opts.sessionId, messageId })
      if (result.error && result.error !== 'aborted') {
        emit({ type: 'toast', level: 'error', text: result.error })
      }
    } catch (err) {
      emit({ type: 'chat.error', sessionId: opts.sessionId, error: (err as Error).message })
    } finally {
      if (this.aborts.get(opts.sessionId) === controller) this.aborts.delete(opts.sessionId)
    }
  }

  abort(sessionId: number): void {
    const controller = this.aborts.get(sessionId)
    if (controller) {
      controller.abort()
      this.aborts.delete(sessionId)
    }
  }
}
