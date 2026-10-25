/**
 * Voice service — wake-word worker lifecycle, Windows SAPI text-to-speech,
 * and BYOK speech-to-text (OpenAI-compatible /audio/transcriptions).
 * Original work © 2026 Ravi Shankar Bera.
 */
import { fork, spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { AppSettings, VoiceStatus } from '../../../shared/types'
import { emit } from '../../bus'
import type { KeyStore } from '../keys'

export class VoiceService {
  private worker: ChildProcess | null = null
  private state: VoiceStatus['workerState'] = 'off'
  private detail: string | undefined
  private speaker: ChildProcess | null = null

  constructor(
    private readonly keys: KeyStore,
    private readonly settings: () => AppSettings,
    private readonly settingsUpdate: (patch: Partial<AppSettings>) => void
  ) {}

  status(): VoiceStatus {
    const s = this.settings()
    return {
      wakeEnabled: s.voice.wakeEnabled,
      workerState: this.state,
      accessKeySet: !!this.keys.get('voice:picovoice'),
      wakeWord: s.voice.wakeWord,
      detail: this.detail
    }
  }

  private publish(): void {
    emit({ type: 'voice.status', state: this.state, detail: this.detail })
  }

  async setWake(enabled: boolean, wakeWord?: string): Promise<VoiceStatus> {
    const current = this.settings()
    const word = (wakeWord ?? current.voice.wakeWord) || 'Computer'
    this.settingsUpdate({ voice: { ...current.voice, wakeEnabled: enabled, wakeWord: word } })

    if (!enabled) {
      this.stopWorker()
      this.state = 'off'
      this.detail = undefined
      this.publish()
      return this.status()
    }

    const accessKey = this.keys.get('voice:picovoice')
    if (!accessKey) {
      this.state = 'error'
      this.detail = 'Picovoice AccessKey missing — add it in Settings → Keys (free at console.picovoice.ai).'
      this.publish()
      return this.status()
    }
    this.startWorker(accessKey, word)
    return this.status()
  }

  private startWorker(accessKey: string, wakeWord: string): void {
    this.stopWorker()
    this.state = 'starting'
    this.detail = undefined
    this.publish()

    const child = fork(path.join(__dirname, 'voice-worker.js'), {
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    })
    this.worker = child

    child.on('message', (msg: { type: string; keyword?: string; message?: string }) => {
      if (this.worker !== child) return
      if (msg.type === 'ready') {
        this.state = 'listening'
        this.detail = `listening for "${wakeWord}"`
        this.publish()
      } else if (msg.type === 'wake') {
        emit({ type: 'voice.wake', keyword: msg.keyword ?? wakeWord })
      } else if (msg.type === 'error') {
        this.state = 'error'
        this.detail = msg.message
        this.publish()
      }
    })
    child.on('exit', (code) => {
      if (this.worker !== child) return
      this.worker = null
      if (this.state !== 'error') {
        this.state = 'off'
        this.detail = `worker exited (${code ?? '?'})`
        this.publish()
      }
    })
    child.on('error', (err) => {
      if (this.worker !== child) return
      this.worker = null
      this.state = 'error'
      this.detail = err.message
      this.publish()
    })

    child.send({ type: 'init', accessKey, keyword: wakeWord })
  }

  private stopWorker(): void {
    const child = this.worker
    this.worker = null
    if (child) {
      try {
        child.send({ type: 'stop' })
      } catch {
        /* ignore */
      }
      child.kill()
    }
  }

  sendPcm(data: ArrayBuffer | Uint8Array): void {
    if (this.worker && !this.worker.killed) {
      try {
        this.worker.send({ type: 'pcm', data })
      } catch {
        /* worker raced out */
      }
    }
  }

  /* --------------------------------- TTS -------------------------------- */

  async speak(text: string): Promise<void> {
    this.stopSpeaking()
    const s = this.settings()
    const escaped = text.slice(0, 3000).replace(/'/g, "''")
    const voice = (s.voice.ttsVoice ?? '').replace(/'/g, "''")
    const rate = Math.max(-10, Math.min(10, Math.round(s.voice.ttsRate)))
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `if ('${voice}' -ne '') { try { $synth.SelectVoice('${voice}') } catch {} }`,
      `$synth.Rate = ${rate}`,
      `$synth.Speak('${escaped}')`
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')

    await new Promise<void>((resolve) => {
      const child = spawnHiddenPowershell(encoded)
      this.speaker = child
      child.on('exit', () => {
        if (this.speaker === child) this.speaker = null
        resolve()
      })
      child.on('error', () => {
        if (this.speaker === child) this.speaker = null
        resolve()
      })
    })
  }

  stopSpeaking(): void {
    const child = this.speaker
    this.speaker = null
    if (child) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
  }

  /** Full teardown on app quit: worker + any ongoing speech. */
  shutdown(): void {
    this.stopWorker()
    this.stopSpeaking()
  }

  /* --------------------------------- STT -------------------------------- */

  async transcribe(audioBase64: string, mime: string): Promise<{ text: string }> {
    const s = this.settings()
    const provider =
      s.providers.find((p) => p.id === s.voice.sttProviderId) ??
      s.providers.find((p) => p.id === 'groq') ??
      s.providers[0]
    if (!provider) throw new Error('No speech-to-text provider configured.')
    const key = this.keys.get(`provider:${provider.id}`)
    if (!key) throw new Error(`Add your ${provider.label} API key in Settings → Keys (used for transcription).`)

    const bytes = Buffer.from(audioBase64, 'base64')
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), 'speech.webm')
    form.append('model', s.voice.sttModel || 'whisper-1')

    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Transcription HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { text?: string }
    return { text: (json.text ?? '').trim() }
  }
}

function spawnHiddenPowershell(encodedCommand: string): ChildProcess {
  return spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand],
    { windowsHide: true, stdio: 'ignore' }
  )
}
