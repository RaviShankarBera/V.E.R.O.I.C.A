/**
 * OpenAI-compatible streaming chat client (BYOK).
 * Works against every preset endpoint: OpenAI, Groq, OpenRouter, Gemini
 * (OpenAI-compat layer), Moonshot/Kimi, DeepSeek, or any custom base URL.
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { ChatResult, ChatToolCall } from '../../shared/types'

export interface OutgoingMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface StreamOptions {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  messages: OutgoingMessage[]
  tools?: ToolSchema[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

interface ToolCallAcc {
  id: string
  name: string
  arguments: string
}

/** POST /chat/completions with stream:true and parse the SSE feed. */
export async function streamChat(opts: StreamOptions): Promise<ChatResult> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    stream: true
  }
  if (opts.tools && opts.tools.length > 0) {
    body['tools'] = opts.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
    body['tool_choice'] = 'auto'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify(body),
    signal: opts.signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Provider HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finishReason = 'stop'
  const toolCalls = new Map<number, ToolCallAcc>()

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let json: {
      choices?: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
        }
        finish_reason?: string | null
      }>
    }
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    const choice = json.choices?.[0]
    if (!choice) return
    const delta = choice.delta
    if (delta?.content) {
      content += delta.content
      opts.onDelta?.(delta.content)
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const acc = toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' }
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name += tc.function.name
        if (tc.function?.arguments) acc.arguments += tc.function.arguments
        toolCalls.set(tc.index, acc)
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      handleLine(line)
    }
  }
  if (buffer.trim()) handleLine(buffer)

  const calls: ChatToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({ id: v.id || `call_${i}`, name: v.name, arguments: v.arguments || '{}' }))

  return { content, toolCalls: calls, finishReason }
}
