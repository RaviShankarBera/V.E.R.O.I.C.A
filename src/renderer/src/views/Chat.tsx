import { useEffect, useRef, useState } from 'react'
import { Mic, Plus, Send, Square, Trash2, Wrench } from 'lucide-react'
import { fmtTime } from '../lib/api'
import { useStore } from '../store'
import { Pill } from '../components/ui'

interface Trace {
  steps?: number
  trace?: Array<{ step: number; name: string; args: string; result: string }>
  error?: string
}

export default function ChatView() {
  const settings = useStore((s) => s.settings)
  const keys = useStore((s) => s.keys)
  const sessions = useStore((s) => s.sessions)
  const activeSession = useStore((s) => s.activeSession)
  const messages = useStore((s) => s.messages)
  const streaming = useStore((s) => s.streaming)
  const recording = useStore((s) => s.recording)
  const micOn = useStore((s) => s.micOn)
  const openSession = useStore((s) => s.openSession)
  const newSession = useStore((s) => s.newSession)
  const deleteSession = useStore((s) => s.deleteSession)
  const sendChat = useStore((s) => s.sendChat)
  const abortChat = useStore((s) => s.abortChat)
  const saveSettings = useStore((s) => s.saveSettings)
  const startPtt = useStore((s) => s.startPtt)
  const stopPtt = useStore((s) => s.stopPtt)
  const toast = useStore((s) => s.toast)

  const [draft, setDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  const providerId = settings?.chat.defaultProviderId ?? ''
  const provider = settings?.providers.find((p) => p.id === providerId)
  const hasKey = keys.find((k) => k.id === `provider:${providerId}`)?.hasKey ?? false

  useEffect(() => {
    setModelDraft(settings?.chat.defaultModel ?? '')
  }, [settings?.chat.defaultModel])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streaming?.buffer, streaming?.tools.length])

  const send = (): void => {
    const text = draft.trim()
    if (!text || streaming) return
    if (!hasKey) {
      toast('error', `No API key for ${provider?.label ?? providerId} — add it in Settings → Keys.`)
      return
    }
    setDraft('')
    void sendChat(text)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* session rail */}
      <div className="flex w-52 shrink-0 flex-col border-r border-ink-700 bg-ink-900/60">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-bold tracking-widest text-slate-500">CHATS</span>
          <button className="btn-ghost !px-2 !py-1" title="New chat" onClick={() => void newSession()}>
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition ${
                s.id === activeSession
                  ? 'bg-veronica-500/15 text-veronica-200'
                  : 'text-slate-400 hover:bg-ink-800'
              }`}
              onClick={() => void openSession(s.id)}
            >
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <button
                className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteSession(s.id)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-ink-700 bg-ink-900/50 px-5 py-2.5">
          <select
            className="input !w-auto !py-1.5 text-xs"
            value={providerId}
            onChange={(e) => {
              const p = settings?.providers.find((x) => x.id === e.target.value)
              if (!p || !settings) return
              void saveSettings({
                chat: { ...settings.chat, defaultProviderId: p.id, defaultModel: p.models[0] ?? '' }
              })
            }}
          >
            {settings?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="input !w-56 !py-1.5 font-mono text-xs"
            list="model-list"
            value={modelDraft}
            placeholder="model id"
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              if (settings && modelDraft.trim() && modelDraft !== settings.chat.defaultModel) {
                void saveSettings({ chat: { ...settings.chat, defaultModel: modelDraft.trim() } })
              }
            }}
          />
          <datalist id="model-list">
            {provider?.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="flex-1" />
          {hasKey ? <Pill tone="ok">key ✓</Pill> : <Pill tone="err">no key</Pill>}
          <Pill tone={settings?.agent.toolConfirmations ? 'warn' : 'idle'}>
            tools {settings?.agent.toolConfirmations ? 'confirm on' : 'confirm off'}
          </Pill>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'bg-veronica-500/90 text-white'
                      : 'border border-ink-700 bg-ink-900 text-slate-200'
                  }`}
                >
                  <div className="prose-veronica">{m.content}</div>
                  {m.tools && <ToolTrace raw={m.tools} />}
                  <div className="mt-1 text-[10px] text-slate-500">{fmtTime(m.createdAt)}</div>
                </div>
              </div>
            ))}

            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-veronica-500/30 bg-ink-900 px-4 py-2.5 text-sm">
                  {streaming.tools.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {streaming.tools.map((t, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-2 py-0.5 text-[11px] text-slate-400"
                          title={t.detail}
                        >
                          <Wrench size={10} className={t.phase === 'start' ? 'text-amber-400' : 'text-mint-400'} />
                          {t.name}
                          {t.phase === 'start' ? '…' : ' ✓'}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="prose-veronica text-slate-200">
                    {streaming.buffer || <span className="pulse-soft text-slate-500">thinking…</span>}
                    {streaming.buffer && <span className="pulse-soft">▌</span>}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-ink-700 bg-ink-900/60 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <button
              className={`btn-ghost !px-3 !py-2.5 ${recording ? '!border-red-500 !text-red-300' : ''}`}
              title="Push to talk (hold)"
              onMouseDown={() => startPtt()}
              onMouseUp={() => stopPtt()}
              onMouseLeave={() => stopPtt()}
            >
              <Mic size={16} className={recording ? 'pulse-soft' : ''} />
            </button>
            <textarea
              className="input min-h-[44px] flex-1 resize-none"
              rows={1}
              placeholder={
                micOn ? 'Message Veronica… (mic on)' : 'Message Veronica… (Enter to send, Shift+Enter newline)'
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            {streaming ? (
              <button className="btn-danger !px-3 !py-2.5" title="Stop" onClick={() => void abortChat()}>
                <Square size={16} />
              </button>
            ) : (
              <button className="btn-primary !px-3 !py-2.5" title="Send" onClick={send} disabled={!draft.trim()}>
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolTrace({ raw }: { raw: string }) {
  let parsed: Trace | null = null
  try {
    parsed = JSON.parse(raw) as Trace
  } catch {
    return null
  }
  if (!parsed?.trace?.length) return parsed?.error ? <div className="mt-1 text-xs text-amber-400">{parsed.error}</div> : null
  return (
    <details className="mt-2 rounded-lg bg-ink-950/70 text-xs">
      <summary className="cursor-pointer px-2 py-1.5 text-slate-500">
        <Wrench size={11} className="mr-1 inline" />
        {parsed.trace.length} tool call{parsed.trace.length > 1 ? 's' : ''}
        {parsed.error ? ` · ${parsed.error}` : ''}
      </summary>
      <div className="space-y-1.5 px-2 pb-2">
        {parsed.trace.map((t, i) => (
          <div key={i} className="border-l-2 border-veronica-500/40 pl-2">
            <span className="font-mono text-veronica-300">{t.name}</span>
            <span className="text-slate-600"> → </span>
            <span className="text-slate-400">{t.result.slice(0, 160)}</span>
          </div>
        ))}
      </div>
    </details>
  )
}
