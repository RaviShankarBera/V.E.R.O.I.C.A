import { useEffect, useState } from 'react'
import { Mic, MicOff, Volume2, Square } from 'lucide-react'
import { req } from '../lib/api'
import { useStore } from '../store'
import { Pill, Toggle } from '../components/ui'
import { Header } from './Memory'
import { WAKE_WORD_CHOICES } from '@shared/types'

export default function VoiceView() {
  const voice = useStore((s) => s.voice)
  const settings = useStore((s) => s.settings)
  const keys = useStore((s) => s.keys)
  const micOn = useStore((s) => s.micOn)
  const recording = useStore((s) => s.recording)
  const lastTranscript = useStore((s) => s.lastTranscript)
  const setWake = useStore((s) => s.setWake)
  const toggleMic = useStore((s) => s.toggleMic)
  const speak = useStore((s) => s.speak)
  const saveKey = useStore((s) => s.saveKey)
  const saveSettings = useStore((s) => s.saveSettings)
  const loadVoice = useStore((s) => s.loadVoice)
  const toast = useStore((s) => s.toast)
  const startPtt = useStore((s) => s.startPtt)
  const stopPtt = useStore((s) => s.stopPtt)

  const [accessKey, setAccessKey] = useState('')
  const [ttsText, setTtsText] = useState('Hello — I am Veronica.')
  const [sttModel, setSttModel] = useState('')

  useEffect(() => {
    void loadVoice()
  }, [loadVoice])
  useEffect(() => {
    setSttModel(settings?.voice.sttModel ?? '')
  }, [settings?.voice.sttModel])

  const picovoice = keys.find((k) => k.id === 'voice:picovoice')
  const stateTone = voice?.workerState === 'listening' ? 'ok' : voice?.workerState === 'error' ? 'err' : 'idle'

  const savePicovoice = async (): Promise<void> => {
    if (!accessKey.trim()) return
    await saveKey('voice:picovoice', accessKey.trim())
    setAccessKey('')
    toast('info', 'Picovoice AccessKey saved')
    await loadVoice()
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Voice" subtitle="Offline wake word (Porcupine) · Windows TTS · BYOK speech-to-text" />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* wake word */}
          <div className="card">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Wake word</span>
              <Pill tone={stateTone}>{voice?.workerState ?? 'off'}</Pill>
              {voice?.detail && <span className="text-[11px] text-slate-500">{voice.detail}</span>}
              <div className="flex-1" />
              <Pill tone={micOn ? 'ok' : 'idle'}>mic {micOn ? 'on' : 'off'}</Pill>
              {recording && <Pill tone="warn">recording</Pill>}
            </div>

            {!picovoice?.hasKey && (
              <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
                Wake word needs a free Picovoice AccessKey →{' '}
                <a className="underline" href="https://console.picovoice.ai/" target="_blank" rel="noreferrer">
                  console.picovoice.ai
                </a>
                . Paste it here (or in Settings → Keys). Chat, voice input and TTS work without it.
                <div className="mt-2 flex gap-2">
                  <input
                    className="input flex-1 !py-1.5 font-mono !text-xs"
                    placeholder="Picovoice AccessKey"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void savePicovoice()}
                  />
                  <button className="btn-primary !py-1.5 !text-xs" onClick={() => void savePicovoice()}>
                    Save key
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Toggle
                checked={voice?.wakeEnabled ?? false}
                onChange={(v) => void setWake(v)}
                label={voice?.wakeEnabled ? `Listening for “${voice?.wakeWord}”` : 'Enable wake word'}
                hint="Say the wake word, then speak — Veronica transcribes and sends it as a chat message"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Wake word:</span>
                <select
                  className="input !w-56"
                  value={settings?.voice.wakeWord ?? 'Computer'}
                  onChange={(e) => {
                    if (voice?.wakeEnabled) void setWake(true, e.target.value)
                    else if (settings) void saveSettings({ voice: { ...settings.voice, wakeWord: e.target.value } })
                  }}
                >
                  {WAKE_WORD_CHOICES.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <Toggle
                  checked={settings?.voice.autoSendTranscript ?? true}
                  onChange={(v) => settings && void saveSettings({ voice: { ...settings.voice, autoSendTranscript: v } })}
                  label="Auto-send transcripts"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={micOn ? 'btn-danger' : 'btn-ghost'}
                  onClick={() => void toggleMic()}
                >
                  {micOn ? <MicOff size={14} /> : <Mic size={14} />} {micOn ? 'Mic off' : 'Mic on'}
                </button>
                <button
                  className="btn-ghost"
                  onMouseDown={() => startPtt()}
                  onMouseUp={() => stopPtt()}
                  onMouseLeave={() => stopPtt()}
                  title="Hold to talk — transcribe without a wake word"
                >
                  <Mic size={14} className={recording ? 'pulse-soft' : ''} /> Hold to talk
                </button>
                {lastTranscript && <span className="flex-1 truncate text-xs text-slate-500">“{lastTranscript}”</span>}
              </div>
            </div>
          </div>

          {/* speech-to-text */}
          <div className="card">
            <div className="mb-2 text-sm font-semibold text-white">Speech to text (BYOK)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label">Provider</div>
                <select
                  className="input"
                  value={settings?.voice.sttProviderId ?? 'groq'}
                  onChange={(e) => settings && void saveSettings({ voice: { ...settings.voice, sttProviderId: e.target.value } })}
                >
                  {settings?.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="label">Model</div>
                <input
                  className="input font-mono !text-xs"
                  value={sttModel}
                  onChange={(e) => setSttModel(e.target.value)}
                  onBlur={() =>
                    settings && void saveSettings({ voice: { ...settings.voice, sttModel: sttModel.trim() } })
                  }
                />
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
              Uses the provider’s <code>/audio/transcriptions</code> endpoint (whisper-class). The API key lives in
              Settings → Keys.
            </div>
          </div>

          {/* text-to-speech */}
          <div className="card">
            <div className="mb-2 text-sm font-semibold text-white">Text to speech (offline, Windows)</div>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div>
                <div className="label">Test phrase</div>
                <input
                  className="input"
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void speak(ttsText)}
                />
              </div>
              <div>
                <div className="label">Rate {settings?.voice.ttsRate ?? 0}</div>
                <input
                  type="range"
                  min={-10}
                  max={10}
                  className="mt-3 w-full accent-veronica-500"
                  value={settings?.voice.ttsRate ?? 0}
                  onChange={(e) => settings && void saveSettings({ voice: { ...settings.voice, ttsRate: Number(e.target.value) } })}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn-primary" onClick={() => void speak(ttsText)}>
                <Volume2 size={14} /> Speak
              </button>
              <button className="btn-ghost" onClick={() => void req('voice.stopSpeaking')}>
                <Square size={13} /> Stop
              </button>
              <input
                className="input ml-auto !w-64 !py-1.5 !text-xs"
                placeholder="voice name (blank = default, e.g. Microsoft David Desktop)"
                value={settings?.voice.ttsVoice ?? ''}
                onChange={(e) => settings && void saveSettings({ voice: { ...settings.voice, ttsVoice: e.target.value } })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
