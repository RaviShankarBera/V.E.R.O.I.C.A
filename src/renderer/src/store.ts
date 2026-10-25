/**
 * Global renderer store — one Zustand store for IPC data, streaming chat
 * state, wake-word capture, and UI (toasts / confirmations).
 * Original work © 2026 Ravi Shankar Bera.
 */
import { create } from 'zustand'
import type {
  AgenticTask,
  AppEvent,
  AppSettings,
  BrowserReadResult,
  BrowserState,
  ChatMessage,
  ChatSession,
  IntegrationConfigView,
  IntegrationStatus,
  KeyMeta,
  MemoryItem,
  MemoryStatus,
  MonitorSnapshot,
  ProcessInfo,
  TaskRun,
  VoiceStatus
} from '@shared/types'
import { req } from './lib/api'
import { MicStream, utteranceToWav } from './lib/voice'

export type View = 'chat' | 'memory' | 'monitor' | 'browser' | 'tasks' | 'integrations' | 'voice' | 'settings'

export interface StreamState {
  sessionId: number
  step: number
  buffer: string
  tools: Array<{ step: number; name: string; phase: 'start' | 'result'; detail: string }>
}

interface Toast {
  id: number
  level: 'info' | 'error'
  text: string
}

interface Utterance {
  mode: 'wake' | 'ptt'
  frames: Int16Array[]
  startedAt: number
  lastLoud: number
  skip: number
  timer: number | null
}

interface Store {
  ready: boolean
  view: View
  info: { version: string; userData: string; platform: string } | null

  settings: AppSettings | null
  keys: KeyMeta[]

  sessions: ChatSession[]
  activeSession: number | null
  messages: ChatMessage[]
  streaming: StreamState | null

  memStatus: MemoryStatus | null
  memories: MemoryItem[]

  snap: MonitorSnapshot | null
  procs: ProcessInfo[]
  procsFilter: string

  browser: BrowserState | null
  browserRead: BrowserReadResult | null
  browserShot: string | null

  tasks: AgenticTask[]
  taskRuns: Record<number, TaskRun[]>

  integStatus: IntegrationStatus[]
  integConfig: IntegrationConfigView[]

  voice: VoiceStatus | null
  micOn: boolean
  recording: boolean
  lastTranscript: string

  confirm: { confirmId: string; tool: string; summary: string; args: unknown } | null
  toasts: Toast[]

  init: () => Promise<void>
  setView: (v: View) => void
  toast: (level: 'info' | 'error', text: string) => void
  dropToast: (id: number) => void

  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  saveKey: (id: string, value: string) => Promise<void>
  deleteKey: (id: string) => Promise<void>

  loadSessions: () => Promise<void>
  openSession: (id: number) => Promise<void>
  newSession: () => Promise<void>
  deleteSession: (id: number) => Promise<void>
  loadHistory: () => Promise<void>
  sendChat: (text: string) => Promise<void>
  abortChat: () => Promise<void>

  loadMemory: () => Promise<void>
  addMemory: (text: string, tags: string) => Promise<void>
  deleteMemory: (id: number) => Promise<void>
  setKillSwitch: (active: boolean) => Promise<void>

  loadSnapshot: () => Promise<void>
  loadProcs: () => Promise<void>
  setProcsFilter: (f: string) => void
  killPid: (pid: number) => Promise<void>

  openBrowser: (url: string, headless?: boolean) => Promise<void>
  closeBrowser: () => Promise<void>
  refreshBrowser: () => Promise<void>
  readBrowser: () => Promise<void>
  shotBrowser: () => Promise<void>
  actBrowser: (action: 'click' | 'type' | 'scroll', selector: string, text?: string) => Promise<void>

  loadTasks: () => Promise<void>
  createTask: (t: {
    title: string
    prompt: string
    scheduleKind: string
    schedule: string
    providerId: string
    model: string
  }) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  runTask: (id: number) => Promise<void>
  loadRuns: (taskId: number) => Promise<void>

  loadIntegrations: () => Promise<void>
  applyIntegration: (
    id: 'telegram' | 'slack' | 'whatsapp',
    enabled: boolean,
    respondToAll?: boolean,
    allowed?: string[]
  ) => Promise<void>
  sendIntegration: (id: 'telegram' | 'slack' | 'whatsapp', target: string, text: string) => Promise<string>

  loadVoice: () => Promise<void>
  setWake: (enabled: boolean, wakeWord?: string) => Promise<void>
  speak: (text: string) => Promise<void>
  toggleMic: (force?: boolean) => Promise<void>
  startPtt: () => void
  stopPtt: () => void
  transcribeWav: (b64: string) => Promise<void>

  respondConfirm: (approved: boolean) => Promise<void>
  handleEvent: (evt: AppEvent) => void
}

const mic = new MicStream()
let utterance: Utterance | null = null
let toastSeq = 1

export const useStore = create<Store>()((set, get) => {
  /* ----------------------------- utterance ---------------------------- */

  const beginUtterance = (mode: 'wake' | 'ptt'): void => {
    if (utterance) return
    const skip = mode === 'wake' ? 9600 : 0 // drop the wake word itself
    utterance = {
      mode,
      frames: [],
      startedAt: Date.now(),
      lastLoud: Date.now(),
      skip,
      timer: mode === 'wake' ? window.setTimeout(() => void finishUtterance(), 15_000) : null
    }
    set({ recording: true })
  }

  const finishUtterance = async (): Promise<void> => {
    const u = utterance
    if (!u) return
    utterance = null
    if (u.timer) window.clearTimeout(u.timer)
    set({ recording: false })
    const total = u.frames.reduce((n, f) => n + f.length, 0)
    if (total < 3200) return // <0.2s: ignore
    const wav = utteranceToWav(u.frames, u.skip)
    await get().transcribeWav(wav)
  }

  const onFrame = (buf: ArrayBuffer): void => {
    // always feed the wake-word worker
    window.veronica.sendPcm(buf)
    const u = utterance
    if (!u) return
    const i16 = new Int16Array(buf)
    let sum = 0
    for (let i = 0; i < i16.length; i++) sum += (i16[i] / 32768) ** 2
    const rms = Math.sqrt(sum / i16.length)
    if (rms > 0.012) u.lastLoud = Date.now()
    u.frames.push(i16.slice())
    const elapsed = Date.now() - u.startedAt
    if (u.mode === 'wake' && elapsed > 800 && Date.now() - u.lastLoud > 1400) {
      void finishUtterance()
    } else if (elapsed > 15_000) {
      void finishUtterance()
    }
  }

  /* ------------------------------ events ------------------------------ */

  const handleEvent = (evt: AppEvent): void => {
    const st = get()
    switch (evt.type) {
      case 'chat.delta': {
        const cur = st.streaming
        if (!cur || cur.sessionId !== evt.sessionId) {
          set({
            streaming: { sessionId: evt.sessionId, step: evt.step, buffer: evt.delta, tools: [] }
          })
        } else if (evt.step > cur.step) {
          set({
            streaming: { ...cur, step: evt.step, buffer: evt.delta }
          })
        } else {
          set({ streaming: { ...cur, buffer: cur.buffer + evt.delta } })
        }
        break
      }
      case 'chat.tool': {
        const cur = st.streaming
        if (!cur || cur.sessionId !== evt.sessionId) break
        set({
          streaming: {
            ...cur,
            tools: [...cur.tools, { step: evt.step, name: evt.name, phase: evt.phase, detail: evt.detail }]
          }
        })
        break
      }
      case 'chat.done': {
        set({ streaming: null })
        void get().loadHistory()
        void get().loadSessions()
        break
      }
      case 'chat.error':
        set({ streaming: null })
        get().toast('error', evt.error)
        break
      case 'agent.confirm':
        set({ confirm: { confirmId: evt.confirmId, tool: evt.tool, summary: evt.summary, args: evt.args } })
        break
      case 'toast':
        get().toast(evt.level, evt.text)
        break
      case 'integration.status': {
        const list = get().integStatus
        set({
          integStatus: list.map((x) =>
            x.id === evt.integration ? { ...x, state: evt.state, detail: evt.detail } : x
          )
        })
        if (evt.state === 'qr') void get().loadIntegrations()
        break
      }
      case 'integration.message':
        get().toast('info', `${evt.integration} ← ${evt.from}: ${evt.text.slice(0, 60)}`)
        break
      case 'voice.status': {
        const v = get().voice
        set({ voice: v ? { ...v, workerState: evt.state, detail: evt.detail } : v })
        break
      }
      case 'voice.wake':
        beginUtterance('wake')
        break
      case 'voice.transcript':
        set({ lastTranscript: evt.text })
        if (evt.text) {
          get().toast('info', `Heard: ${evt.text}`)
          if (get().settings?.voice.autoSendTranscript) void get().sendChat(evt.text)
        }
        break
      case 'task.update':
        void get().loadTasks()
        break
      case 'agent.progress':
        get().toast('info', `Agent ${evt.stage}${evt.detail ? `: ${evt.detail.slice(0, 120)}` : ''}`)
        break
    }
  }

  return {
    ready: false,
    view: 'chat',
    info: null,
    settings: null,
    keys: [],
    sessions: [],
    activeSession: null,
    messages: [],
    streaming: null,
    memStatus: null,
    memories: [],
    snap: null,
    procs: [],
    procsFilter: '',
    browser: null,
    browserRead: null,
    browserShot: null,
    tasks: [],
    taskRuns: {},
    integStatus: [],
    integConfig: [],
    voice: null,
    micOn: false,
    recording: false,
    lastTranscript: '',
    confirm: null,
    toasts: [],

    init: async () => {
      try {
        const [info, settings, keys, voice, integStatus, integConfig, browser] = await Promise.all([
          req('app.info'),
          req('settings.get'),
          req('keys.list'),
          req('voice.status'),
          req('integrations.status'),
          req('integrations.config'),
          req('browser.state')
        ])
        set({ info, settings, keys, voice, integStatus, integConfig, browser, ready: true })
        await get().loadSessions()
        if (get().sessions.length === 0) await get().newSession()
        else set({ activeSession: get().sessions[0].id })
        await get().loadHistory()
      } catch (err) {
        set({ ready: true })
        get().toast('error', `Init failed: ${(err as Error).message}`)
      }
    },

    setView: (v) => set({ view: v }),

    toast: (level, text) => {
      const id = toastSeq++
      set({ toasts: [...get().toasts, { id, level, text }] })
      window.setTimeout(() => get().dropToast(id), level === 'error' ? 8000 : 4500)
    },
    dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    saveSettings: async (patch) => {
      const settings = await req('settings.set', patch)
      set({ settings })
    },
    saveKey: async (id, value) => {
      await req('keys.set', { id, value })
      set({ keys: await req('keys.list') })
    },
    deleteKey: async (id) => {
      await req('keys.delete', { id })
      set({ keys: await req('keys.list') })
    },

    loadSessions: async () => set({ sessions: await req('chat.sessions') }),
    openSession: async (id) => {
      set({ activeSession: id, streaming: null })
      await get().loadHistory()
    },
    newSession: async () => {
      const s = await req('chat.create')
      set({ sessions: [s, ...get().sessions], activeSession: s.id, messages: [], streaming: null })
    },
    deleteSession: async (id) => {
      await req('chat.delete', { id })
      const sessions = get().sessions.filter((s) => s.id !== id)
      set({ sessions })
      if (get().activeSession === id) {
        if (sessions.length === 0) await get().newSession()
        else await get().openSession(sessions[0].id)
      }
    },
    loadHistory: async () => {
      const id = get().activeSession
      if (id == null) return
      set({ messages: await req('chat.history', { sessionId: id }) })
    },

    sendChat: async (text) => {
      const s = get().settings
      if (!s) return
      let sessionId = get().activeSession
      if (sessionId == null) {
        await get().newSession()
        sessionId = get().activeSession!
      }
      await req('chat.send', {
        sessionId,
        providerId: s.chat.defaultProviderId,
        model: s.chat.defaultModel,
        text,
        useTools: true
      })
      set({
        streaming: { sessionId, step: 0, buffer: '', tools: [] },
        messages: [
          ...get().messages,
          { id: -Date.now(), sessionId, role: 'user', content: text, createdAt: Date.now() }
        ]
      })
    },
    abortChat: async () => {
      const id = get().activeSession
      if (id != null) await req('chat.abort', { sessionId: id })
    },

    loadMemory: async () => {
      const [memStatus, memories] = await Promise.all([req('memory.status'), req('memory.list', { limit: 200 })])
      set({ memStatus, memories })
    },
    addMemory: async (text, tags) => {
      await req('memory.add', { text, tags })
      await get().loadMemory()
    },
    deleteMemory: async (id) => {
      await req('memory.delete', { id })
      await get().loadMemory()
    },
    setKillSwitch: async (active) => {
      const memStatus = await req('memory.setKillSwitch', { active })
      set({ memStatus })
    },

    loadSnapshot: async () => set({ snap: await req('monitor.snapshot') }),
    loadProcs: async () => set({ procs: await req('monitor.processes', { filter: get().procsFilter }) }),
    setProcsFilter: (f) => set({ procsFilter: f }),
    killPid: async (pid) => {
      const res = await req('monitor.kill', { pid })
      get().toast(res.ok ? 'info' : 'error', res.ok ? `Killed ${pid}` : (res.reason ?? 'Refused'))
      await get().loadProcs()
    },

    openBrowser: async (url, headless) => {
      set({ browser: await req('browser.open', { url, headless }) })
      set({ browserRead: null, browserShot: null })
    },
    closeBrowser: async () => set({ browser: await req('browser.close') }),
    refreshBrowser: async () => set({ browser: await req('browser.state') }),
    readBrowser: async () => set({ browserRead: await req('browser.read') }),
    shotBrowser: async () => {
      const shot = await req('browser.screenshot')
      set({ browserShot: shot.dataUrl })
    },
    actBrowser: async (action, selector, text) => {
      const res = await req('browser.act', { action, selector, text })
      get().toast(res.ok ? 'info' : 'error', res.detail)
      await get().refreshBrowser()
    },

    loadTasks: async () => set({ tasks: await req('tasks.list') }),
    createTask: async (t) => {
      await req('tasks.create', t)
      await get().loadTasks()
    },
    deleteTask: async (id) => {
      await req('tasks.delete', { id })
      await get().loadTasks()
    },
    runTask: async (id) => {
      await req('tasks.runNow', { id })
      get().toast('info', 'Task started')
      window.setTimeout(() => void get().loadTasks(), 1500)
    },
    loadRuns: async (taskId) => {
      const runs = await req('tasks.runs', { taskId })
      set({ taskRuns: { ...get().taskRuns, [taskId]: runs } })
    },

    loadIntegrations: async () => {
      const [integStatus, integConfig] = await Promise.all([
        req('integrations.status'),
        req('integrations.config')
      ])
      set({ integStatus, integConfig })
    },
    applyIntegration: async (id, enabled, respondToAll, allowed) => {
      const integConfig = await req('integrations.apply', { id, enabled, respondToAll, allowed })
      set({ integConfig })
      window.setTimeout(() => void get().loadIntegrations(), 800)
    },
    sendIntegration: async (id, target, text) => {
      const res = await req('integrations.send', { id, target, text })
      if (!res.ok) throw new Error(res.detail ?? 'send failed')
      return 'Sent'
    },

    loadVoice: async () => set({ voice: await req('voice.status') }),
    setWake: async (enabled, wakeWord) => {
      set({ voice: await req('voice.setWake', { enabled, wakeWord }) })
      const s = get().settings
      if (s) set({ settings: { ...s, voice: { ...s.voice, wakeEnabled: enabled, wakeWord: wakeWord ?? s.voice.wakeWord } } })
      if (enabled) await get().toggleMic(true)
      else await get().toggleMic(false)
    },
    speak: async (text) => {
      await req('voice.speak', { text })
    },
    toggleMic: async (force?: boolean) => {
      const want = force ?? !get().micOn
      if (want) {
        try {
          await mic.start(onFrame)
          set({ micOn: true })
        } catch (err) {
          get().toast('error', `Microphone unavailable: ${(err as Error).message}`)
        }
      } else {
        mic.stop()
        set({ micOn: false })
        if (utterance) void finishUtterance()
      }
    },
    startPtt: () => {
      if (!get().micOn) void get().toggleMic(true).then(() => beginUtterance('ptt'))
      else beginUtterance('ptt')
    },
    stopPtt: () => {
      if (utterance?.mode === 'ptt') void finishUtterance()
    },
    transcribeWav: async (b64) => {
      try {
        const { text } = await req('voice.transcribe', { audioBase64: b64, mime: 'audio/wav' })
        handleEvent({ type: 'voice.transcript', text })
      } catch (err) {
        get().toast('error', (err as Error).message)
      }
    },

    respondConfirm: async (approved) => {
      const c = get().confirm
      if (!c) return
      set({ confirm: null })
      await req('agent.respond', { confirmId: c.confirmId, approved })
    },

    handleEvent
  }
})
