/**
 * The Harness Agent — Veronica's agentic loop engine.
 * Streams tool-calls in and out of any OpenAI-compatible model with hard
 * step limits, confirmation gates for mutating tools, and abort support.
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { AppSettings, ChatToolCall, KeyMeta } from '../../shared/types'
import { streamChat, type OutgoingMessage, type ToolSchema } from './providers'
import { TOOLS, toolSchemas, type ToolCtxBase, type ToolContext } from './agent/tools'

export interface HarnessCallbacks {
  onDelta?: (step: number, text: string) => void
  onToolStart?: (step: number, name: string, args: unknown) => void
  onToolResult?: (step: number, name: string, result: string) => void
}

export interface HarnessOptions extends HarnessCallbacks {
  settings: AppSettings
  keys: ToolContext['keys']
  providerBaseUrl: string
  providerId: string
  model: string
  systemPrompt: string
  history: OutgoingMessage[]
  userText: string
  useTools: boolean
  /** Confirms mutating tools; when absent (headless runs) they auto-deny. */
  confirm?: (tool: string, args: unknown, summary: string) => Promise<boolean>
  signal?: AbortSignal
}

export interface HarnessResult {
  text: string
  steps: number
  toolTrace: Array<{ step: number; name: string; args: string; result: string }>
  error?: string
}

function apiKeyFor(ctx: { keys: ToolContext['keys']; providerId: string }): string {
  const key = ctx.keys.get(`provider:${ctx.providerId}`)
  if (!key) throw new Error(`No API key stored for provider "${ctx.providerId}" — add it in Settings → Keys.`)
  return key
}

export async function runHarness(
  opts: HarnessOptions,
  ctxBase: ToolCtxBase
): Promise<HarnessResult> {
  const apiKey = apiKeyFor(opts)
  const messages: OutgoingMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userText }
  ]
  const schemas: ToolSchema[] | undefined = opts.useTools ? toolSchemas() : undefined
  const trace: HarnessResult['toolTrace'] = []
  const maxSteps = Math.max(1, Math.min(opts.settings.agent.maxSteps, 16))
  const confirmationsOn = opts.settings.agent.toolConfirmations

  const ctx: ToolContext = {
    ...ctxBase,
    keys: opts.keys,
    settings: () => opts.settings,
    requestConfirm: async (tool, args, summary) => {
      if (!confirmationsOn || !opts.confirm) return false
      return opts.confirm(tool, args, summary)
    }
  }

  let lastText = ''
  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (opts.signal?.aborted) return { text: lastText, steps: step, toolTrace: trace, error: 'aborted' }

      const result = await streamChat({
        baseUrl: opts.providerBaseUrl,
        apiKey,
        model: opts.model,
        temperature: opts.settings.chat.temperature,
        messages,
        tools: schemas,
        signal: opts.signal,
        onDelta: (t) => {
          lastText += t
          opts.onDelta?.(step, t)
        }
      })

      if (result.toolCalls.length === 0) {
        return { text: result.content || lastText, steps: step, toolTrace: trace }
      }

      // Model wants tools — record the assistant turn, execute each call.
      if (result.content) {
        messages.push({ role: 'assistant', content: result.content, tool_calls: toolCallsWire(result.toolCalls) })
      } else {
        messages.push({ role: 'assistant', content: null, tool_calls: toolCallsWire(result.toolCalls) })
      }

      for (const call of result.toolCalls) {
        const args = safeParse(call.arguments)
        opts.onToolStart?.(step, call.name, args)
        const resultText = await runOneTool(call, args, ctx)
        opts.onToolResult?.(step, call.name, resultText)
        trace.push({ step, name: call.name, args: call.arguments, result: resultText.slice(0, 2000) })
        messages.push({ role: 'tool', content: resultText, tool_call_id: call.id, name: call.name })
      }
      lastText = '' // intermediate prose before tool use doesn't count as final answer
    }
    return {
      text: lastText,
      steps: maxSteps,
      toolTrace: trace,
      error: `Stopped after ${maxSteps} steps (maxSteps limit).`
    }
  } catch (err) {
    const msg = (err as Error).message || String(err)
    if ((err as Error).name === 'AbortError') return { text: lastText, steps: 0, toolTrace: trace, error: 'aborted' }
    return { text: lastText, steps: 0, toolTrace: trace, error: msg }
  }
}

async function runOneTool(
  call: ChatToolCall,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const tool = TOOLS.find((t) => t.name === call.name)
  if (!tool) return `Unknown tool "${call.name}".`
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Tool ${tool.name} timed out after 60s`)), 60_000)
    )
    return await Promise.race([tool.execute(args, ctx), timeout])
  } catch (err) {
    return `Tool error: ${(err as Error).message}`
  }
}

function toolCallsWire(calls: ChatToolCall[]): NonNullable<OutgoingMessage['tool_calls']> {
  return calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } }))
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Headless run used by integrations and agentic tasks (no confirmations). */
export async function runHeadless(
  prompt: string,
  opts: {
    settings: AppSettings
    keys: ToolContext['keys']
    providerId: string
    model: string
    useTools: boolean
    systemPrompt: string
  },
  ctxBase: ToolCtxBase
): Promise<string> {
  const provider = opts.settings.providers.find((p) => p.id === opts.providerId)
  if (!provider) throw new Error(`Unknown provider "${opts.providerId}"`)
  const res = await runHarness(
    {
      settings: opts.settings,
      keys: opts.keys,
      providerBaseUrl: provider.baseUrl,
      providerId: opts.providerId,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      history: [],
      userText: prompt,
      useTools: opts.useTools
    },
    ctxBase
  )
  if (res.error && !res.text) throw new Error(res.error)
  return res.text || res.error || '(no output)'
}

export type { KeyMeta }
