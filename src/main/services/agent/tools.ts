/**
 * Agent tool registry — what the Harness Agent is allowed to do.
 * Every tool is explicit; mutating tools can require interactive confirmation.
 * NOTE: by design there is NO arbitrary shell/command-execution tool in v1
 * (the analyzed product shipped one with zero guardrails; this one ships none).
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { AppSettings, IntegrationId } from '../../../shared/types'
import type { BrowserService } from '../browser'
import type { MemoryService } from '../memory'
import type { KeyStore } from '../keys'
import { killProcess, listProcesses, snapshot } from '../monitor'
import { streamChat, type OutgoingMessage, type ToolSchema } from '../providers'

export interface ToolContext {
  settings: () => AppSettings
  keys: KeyStore
  memory: MemoryService
  browser: BrowserService
  sendIntegration: (id: IntegrationId, target: string | undefined, text: string) => Promise<{ ok: boolean; detail?: string }>
  speak: (text: string) => Promise<void>
  requestConfirm: (tool: string, args: unknown, summary: string) => Promise<boolean>
}

export interface ToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string | string[]; description?: string; enum?: string[] }>
    required?: string[]
  }
  requiresConfirm?: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

/** The shared services every harness run needs (confirm/settings are added per run). */
export type ToolCtxBase = Pick<ToolContext, 'memory' | 'browser' | 'sendIntegration' | 'speak' | 'settings'>

const j = (v: unknown): string => JSON.stringify(v, null, 1)

export const TOOLS: ToolDef[] = [
  {
    name: 'memory_search',
    description: 'Search Veronica\'s local long-term memory for facts the user has saved.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        limit: { type: 'number', description: 'Max results (default 8)' }
      },
      required: ['query']
    },
    execute: async (a, ctx) =>
      j(ctx.memory.searchMemories(String(a['query']), Number(a['limit']) || 8))
  },
  {
    name: 'memory_save',
    description: 'Save a durable fact or preference to local memory. Use sparingly.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Fact to remember' },
        tags: { type: 'string', description: 'Comma-separated tags' }
      },
      required: ['text']
    },
    execute: async (a, ctx) => {
      const item = ctx.memory.addMemory(String(a['text']), String(a['tags'] ?? ''), 'agent')
      return item
        ? `Saved memory #${item.id}`
        : 'Refused: memory is disabled or the kill-switch file is active.'
    }
  },
  {
    name: 'system_snapshot',
    description: 'Current CPU load, RAM, swap and disk usage of this PC.',
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => j(await snapshot(ctx.settings().monitor.refreshMs))
  },
  {
    name: 'system_processes',
    description: 'List top processes by CPU. System-critical and Veronica\'s own processes are excluded.',
    parameters: {
      type: 'object',
      properties: { filter: { type: 'string', description: 'Optional name filter' } }
    },
    execute: async (a) => j(await listProcesses(a['filter'] ? String(a['filter']) : undefined))
  },
  {
    name: 'system_kill_process',
    description:
      'Terminate a user-owned process by PID. Requires explicit user confirmation. Never works on system processes.',
    parameters: {
      type: 'object',
      properties: { pid: { type: 'number', description: 'PID to terminate' } },
      required: ['pid']
    },
    requiresConfirm: true,
    execute: async (a, ctx) => {
      const pid = Number(a['pid'])
      const approved = await ctx.requestConfirm('system_kill_process', a, `Terminate process ${pid}?`)
      if (!approved) return 'Denied by user.'
      const res = await killProcess(pid)
      return res.ok ? `Process ${pid} terminated.` : res.reason ?? 'Failed.'
    }
  },
  {
    name: 'browser_open',
    description: 'Open a URL in the local browser (Playwright-driven Edge). Returns page state.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'https URL to open' } },
      required: ['url']
    },
    execute: async (a, ctx) => {
      const s = ctx.settings()
      const state = await ctx.browser.open(String(a['url']), s.browser.headless, s.browser.channel)
      return j(state)
    }
  },
  {
    name: 'browser_read',
    description: 'Read the current page: URL, title and visible text.',
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => j(await ctx.browser.read())
  },
  {
    name: 'browser_act',
    description: 'Interact with the current page: click an element, fill a field, or scroll.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'type', 'scroll'] },
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Text to type (type action only)' }
      },
      required: ['action', 'selector']
    },
    requiresConfirm: true,
    execute: async (a, ctx) => {
      const action = String(a['action']) as 'click' | 'type' | 'scroll'
      const selector = String(a['selector'])
      const approved = await ctx.requestConfirm(
        'browser_act',
        a,
        `${action} ${selector}${a['text'] ? ` ← "${String(a['text'])}"` : ''}`
      )
      if (!approved) return 'Denied by user.'
      const res = await ctx.browser.act(action, selector, a['text'] ? String(a['text']) : undefined)
      return res.ok ? res.detail : `Failed: ${res.detail}`
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Capture the current page as a PNG (saved under the app data folder).',
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => {
      const shot = await ctx.browser.screenshot()
      return `Saved screenshot to ${shot.path}`
    }
  },
  {
    name: 'browser_close',
    description: 'Close the automated browser.',
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => j(await ctx.browser.close())
  },
  {
    name: 'task_create',
    description: 'Schedule an agentic task: a prompt Veronica runs unattended, once, on an interval, or on a cron schedule.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        prompt: { type: 'string', description: 'What Veronica should do each run' },
        schedule_kind: { type: 'string', enum: ['once', 'interval', 'cron'], description: 'Schedule type' },
        schedule: {
          type: 'string',
          description: 'once: minutes from now | interval: minutes | cron: 5-field cron expression'
        }
      },
      required: ['title', 'prompt', 'schedule_kind', 'schedule']
    },
    execute: async (a, ctx) => {
      const s = ctx.settings()
      const { computeNextRun } = await import('../tasks')
      const kind = String(a['schedule_kind'])
      const sched = String(a['schedule'])
      const next = computeNextRun(kind, sched, Date.now())
      if (kind !== 'once' && next === null) return `Invalid schedule "${sched}".`
      const task = ctx.memory.createTask({
        title: String(a['title']),
        prompt: String(a['prompt']),
        scheduleKind: kind,
        schedule: sched,
        providerId: s.chat.defaultProviderId,
        model: s.chat.defaultModel,
        nextRunAt: kind === 'once' ? Date.now() + Math.max(1, Number(sched) || 1) * 60_000 : next
      })
      return `Created task #${task.id} "${task.title}" (${kind}: ${sched})`
    }
  },
  {
    name: 'task_list',
    description: 'List configured agentic tasks and their status.',
    parameters: { type: 'object', properties: {} },
    execute: async (_a, ctx) => j(ctx.memory.listTasks())
  },
  {
    name: 'integration_send',
    description: 'Send a message through a connected messaging integration (telegram, slack, whatsapp).',
    parameters: {
      type: 'object',
      properties: {
        integration: { type: 'string', enum: ['telegram', 'slack', 'whatsapp'] },
        target: { type: 'string', description: 'Chat/channel id; omit to use the default allowed target' },
        text: { type: 'string' }
      },
      required: ['integration', 'text']
    },
    requiresConfirm: true,
    execute: async (a, ctx) => {
      const approved = await ctx.requestConfirm(
        'integration_send',
        a,
        `Send via ${String(a['integration'])}: ${String(a['text']).slice(0, 80)}`
      )
      if (!approved) return 'Denied by user.'
      const res = await ctx.sendIntegration(
        a['integration'] as IntegrationId,
        a['target'] ? String(a['target']) : undefined,
        String(a['text'])
      )
      return res.ok ? 'Sent.' : `Failed: ${res.detail ?? 'unknown error'}`
    }
  },
  {
    name: 'tts_speak',
    description: 'Speak text aloud through the Windows speech synthesizer.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    },
    execute: async (a, ctx) => {
      await ctx.speak(String(a['text']))
      return 'Spoken.'
    }
  }
]

export function toolSchemas(names?: string[]): ToolSchema[] {
  return TOOLS.filter((t) => !names || names.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))
}

/* Re-exported for harness-side chat assembly */
export type { OutgoingMessage }
export { streamChat }
