/**
 * IPC router — the single request channel. Every method name is matched
 * against an explicit allowlist (the switch below); unknown methods, bad
 * payloads, and untrusted senders are rejected. This is the hardened
 * replacement for the open-bridge IPC the analyzed app shipped.
 * Original work © 2026 Ravi Shankar Bera.
 */
import { app, ipcMain } from 'electron'
import type { AppSettings, MethodName, RequestEnvelope, SendChatOptions } from '../shared/types'
import { IPC_PCM, IPC_REQUEST } from '../shared/types'
import { emit } from './bus'
import { runHarness } from './services/harness'
import { killProcess, listProcesses, snapshot } from './services/monitor'
import { computeNextRun } from './services/tasks'
import { isTrustedSender } from './security'
import type { AppRegistry } from './services/registry'

/* ------------------------------ helpers ------------------------------- */

function asObject(v: unknown, method: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${method}: payload must be an object`)
  }
  return v as Record<string, unknown>
}

function str(v: unknown, name: string, allowEmpty = false): string {
  if (typeof v !== 'string' || (!allowEmpty && !v.trim())) throw new Error(`${name}: expected non-empty string`)
  return v
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name}: expected number`)
  return v
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${name}: expected boolean`)
  return v
}

const KEY_ID_RE = /^(provider:[a-z0-9_-]+|integration:[a-z-]+|voice:[a-z]+)$/
const INTEGRATIONS = new Set(['telegram', 'slack', 'whatsapp'])

/* ------------------------------ dispatch ------------------------------ */

async function dispatch(reg: AppRegistry, method: string, raw: unknown): Promise<unknown> {
  const s = () => reg.settings.get()

  switch (method as MethodName) {
    /* app */
    case 'app.info':
      return { version: app.getVersion(), userData: app.getPath('userData'), platform: process.platform }

    /* settings & keys */
    case 'settings.get':
      return s()
    case 'settings.set': {
      const patch = asObject(raw, method) as Partial<AppSettings>
      const updated = reg.settings.update(patch)
      // keep Windows login behaviour in sync with the setting
      if (patch.general && typeof patch.general.launchAtLogin === 'boolean') {
        try {
          app.setLoginItemSettings({ openAtLogin: patch.general.launchAtLogin })
        } catch {
          /* unsupported environment */
        }
      }
      return updated
    }
    case 'keys.list':
      return reg.keys.list()
    case 'keys.set': {
      const p = asObject(raw, method)
      const id = str(p['id'], 'id')
      if (!KEY_ID_RE.test(id)) throw new Error('keys.set: invalid key id')
      return reg.keys.set(id, str(p['value'], 'value', true))
    }
    case 'keys.delete': {
      const p = asObject(raw, method)
      const id = str(p['id'], 'id')
      if (!KEY_ID_RE.test(id)) throw new Error('keys.delete: invalid key id')
      reg.keys.delete(id)
      return undefined
    }

    /* chat */
    case 'chat.sessions':
      return reg.memory.listSessions()
    case 'chat.create': {
      const title = raw ? (asObject(raw, method)['title'] as string | undefined) : undefined
      return reg.memory.createSession(title)
    }
    case 'chat.delete': {
      const p = asObject(raw, method)
      reg.memory.deleteSession(num(p['id'], 'id'))
      return undefined
    }
    case 'chat.history': {
      const p = asObject(raw, method)
      return reg.memory.history(num(p['sessionId'], 'sessionId'), s().chat.historyLimit)
    }
    case 'chat.send': {
      const p = asObject(raw, method) as unknown as SendChatOptions
      const opts: SendChatOptions = {
        sessionId: num(p.sessionId, 'sessionId'),
        providerId: str(p.providerId, 'providerId'),
        model: str(p.model, 'model'),
        text: str(p.text, 'text'),
        useTools: p.useTools === true
      }
      void reg.chat.send(opts) // streaming continues over events
      return { ok: true as const }
    }
    case 'chat.abort': {
      const p = asObject(raw, method)
      reg.chat.abort(num(p['sessionId'], 'sessionId'))
      return undefined
    }

    /* agent */
    case 'agent.run': {
      const p = asObject(raw, method)
      const runId = str(p['runId'], 'runId')
      const prompt = str(p['prompt'], 'prompt')
      const providerId = str(p['providerId'], 'providerId')
      const model = str(p['model'], 'model')
      const useTools = p['useTools'] !== false
      const cfg = s()
      const provider = cfg.providers.find((x) => x.id === providerId)
      if (!provider) throw new Error(`Unknown provider "${providerId}"`)
      void (async () => {
        emit({ type: 'agent.progress', runId, stage: 'start' })
        const res = await runHarness(
          {
            settings: cfg,
            keys: reg.keys,
            providerBaseUrl: provider.baseUrl,
            providerId,
            model,
            systemPrompt: cfg.chat.systemPrompt,
            history: [],
            userText: prompt,
            useTools,
            confirm: (t, a, sum) => reg.confirm.request(t, a, sum),
            onToolStart: (_step, name) => emit({ type: 'agent.progress', runId, stage: 'tool', detail: name }),
            onDelta: undefined
          },
          reg.ctxBase
        )
        emit({ type: 'agent.progress', runId, stage: 'final', detail: res.error ?? res.text })
      })()
      return { ok: true as const }
    }
    case 'agent.respond': {
      const p = asObject(raw, method)
      reg.confirm.respond(str(p['confirmId'], 'confirmId'), p['approved'] === true)
      return undefined
    }

    /* memory */
    case 'memory.status':
      return {
        enabled: s().memory.enabled,
        count: reg.memory.memoryCount(),
        killSwitchActive: reg.memory.killSwitchActive,
        killSwitchPath: reg.memory.killSwitchPath,
        dbPath: reg.memory.dbPath
      }
    case 'memory.search': {
      const p = asObject(raw, method)
      return reg.memory.searchMemories(str(p['query'], 'query', true), p['limit'] ? num(p['limit'], 'limit') : 8)
    }
    case 'memory.list': {
      const p = raw ? asObject(raw, method) : {}
      return reg.memory.listMemories(p['limit'] ? num(p['limit'], 'limit') : 100)
    }
    case 'memory.add': {
      const p = asObject(raw, method)
      const item = reg.memory.addMemory(
        str(p['text'], 'text'),
        p['tags'] !== undefined ? str(p['tags'], 'tags', true) : '',
        'manual'
      )
      if (!item) throw new Error('Memory write refused (kill switch active or empty text).')
      return item
    }
    case 'memory.delete': {
      const p = asObject(raw, method)
      reg.memory.deleteMemory(num(p['id'], 'id'))
      return undefined
    }
    case 'memory.setKillSwitch': {
      const p = asObject(raw, method)
      reg.memory.setKillSwitch(bool(p['active'], 'active'))
      return {
        enabled: s().memory.enabled,
        count: reg.memory.memoryCount(),
        killSwitchActive: reg.memory.killSwitchActive,
        killSwitchPath: reg.memory.killSwitchPath,
        dbPath: reg.memory.dbPath
      }
    }

    /* monitor */
    case 'monitor.snapshot':
      return snapshot(s().monitor.refreshMs)
    case 'monitor.processes': {
      const p = raw ? asObject(raw, method) : {}
      return listProcesses(p['filter'] !== undefined ? str(p['filter'], 'filter', true) : undefined)
    }
    case 'monitor.kill': {
      const p = asObject(raw, method)
      return killProcess(num(p['pid'], 'pid'))
    }

    /* browser */
    case 'browser.open': {
      const p = asObject(raw, method)
      const cfg = s().browser
      return reg.browser.open(
        str(p['url'], 'url'),
        p['headless'] !== undefined ? bool(p['headless'], 'headless') : cfg.headless,
        cfg.channel
      )
    }
    case 'browser.close':
      return reg.browser.close()
    case 'browser.state':
      return reg.browser.state()
    case 'browser.read':
      return reg.browser.read()
    case 'browser.screenshot':
      return reg.browser.screenshot()
    case 'browser.act': {
      const p = asObject(raw, method)
      const action = str(p['action'], 'action') as 'click' | 'type' | 'scroll'
      if (!['click', 'type', 'scroll'].includes(action)) throw new Error('browser.act: bad action')
      return reg.browser.act(
        action,
        str(p['selector'], 'selector', true),
        p['text'] !== undefined ? str(p['text'], 'text', true) : undefined
      )
    }

    /* tasks */
    case 'tasks.list':
      return reg.memory.listTasks()
    case 'tasks.create': {
      const p = asObject(raw, method)
      const kind = str(p['scheduleKind'], 'scheduleKind')
      if (!['once', 'interval', 'cron'].includes(kind)) throw new Error('tasks.create: bad scheduleKind')
      const schedule = str(p['schedule'], 'schedule')
      const next =
        kind === 'once'
          ? Date.now() + Math.max(1, Number(schedule) || 1) * 60_000
          : computeNextRun(kind, schedule, Date.now())
      if (next === null) throw new Error('tasks.create: invalid schedule')
      const task = reg.memory.createTask({
        title: str(p['title'], 'title'),
        prompt: str(p['prompt'], 'prompt'),
        scheduleKind: kind,
        schedule,
        providerId: str(p['providerId'], 'providerId'),
        model: str(p['model'], 'model'),
        nextRunAt: next
      })
      emit({ type: 'task.update', taskId: task.id })
      return task
    }
    case 'tasks.update': {
      const p = asObject(raw, method)
      const patch = asObject(p['patch'], 'patch')
      const task = reg.memory.updateTask(num(p['id'], 'id'), patch as never)
      if (!task) throw new Error('Task not found')
      emit({ type: 'task.update', taskId: task.id })
      return task
    }
    case 'tasks.delete': {
      const p = asObject(raw, method)
      reg.memory.deleteTask(num(p['id'], 'id'))
      return undefined
    }
    case 'tasks.runNow': {
      const p = asObject(raw, method)
      void reg.tasks.runTask(num(p['id'], 'id'))
      return undefined
    }
    case 'tasks.runs': {
      const p = asObject(raw, method)
      return reg.memory.taskRuns(num(p['taskId'], 'taskId'))
    }

    /* integrations */
    case 'integrations.status':
      return reg.integrations.status()
    case 'integrations.config':
      return reg.integrations.config()
    case 'integrations.apply': {
      const p = asObject(raw, method)
      const id = str(p['id'], 'id')
      if (!INTEGRATIONS.has(id)) throw new Error('integrations.apply: bad id')
      const allowed = Array.isArray(p['allowed'])
        ? (p['allowed'] as unknown[]).map((x) => str(x, 'allowed[]', true)).filter(Boolean)
        : undefined
      return reg.integrations.apply(
        id as 'telegram' | 'slack' | 'whatsapp',
        bool(p['enabled'], 'enabled'),
        p['respondToAll'] !== undefined ? bool(p['respondToAll'], 'respondToAll') : undefined,
        allowed
      )
    }
    case 'integrations.send': {
      const p = asObject(raw, method)
      const id = str(p['id'], 'id')
      if (!INTEGRATIONS.has(id)) throw new Error('integrations.send: bad id')
      return reg.integrations.send(
        id as 'telegram' | 'slack' | 'whatsapp',
        p['target'] !== undefined ? str(p['target'], 'target', true) : undefined,
        str(p['text'], 'text')
      )
    }

    /* voice */
    case 'voice.status':
      return reg.voice.status()
    case 'voice.setWake': {
      const p = asObject(raw, method)
      return reg.voice.setWake(
        bool(p['enabled'], 'enabled'),
        p['wakeWord'] !== undefined ? str(p['wakeWord'], 'wakeWord', true) : undefined
      )
    }
    case 'voice.transcribe': {
      const p = asObject(raw, method)
      return reg.voice.transcribe(str(p['audioBase64'], 'audioBase64'), str(p['mime'], 'mime', true))
    }
    case 'voice.speak': {
      const p = asObject(raw, method)
      void reg.voice.speak(str(p['text'], 'text'))
      return { ok: true as const }
    }
    case 'voice.stopSpeaking':
      reg.voice.stopSpeaking()
      return undefined

    default:
      throw new Error(`Unknown method "${method}"`)
  }
}

/* ------------------------------- install ------------------------------ */

export function installRouter(reg: AppRegistry): void {
  // High-frequency wake-word PCM stream (validated like every other channel).
  ipcMain.on(IPC_PCM, (event, data: ArrayBuffer | Uint8Array) => {
    const url = event.senderFrame?.url ?? ''
    if (!isTrustedSender(url)) return
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) reg.voice.sendPcm(data)
  })

  ipcMain.handle(IPC_REQUEST, async (event, envelope: RequestEnvelope) => {
    const url = event.senderFrame?.url ?? ''
    if (!isTrustedSender(url)) {
      return { ok: false, error: 'Rejected: untrusted IPC sender.' }
    }
    if (!envelope || typeof envelope.method !== 'string') {
      return { ok: false, error: 'Malformed request.' }
    }
    try {
      const data = await dispatch(reg, envelope.method, envelope.payload)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })
}
