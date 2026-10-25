/**
 * Renderer-side audio capture for wake word + push-to-talk.
 * Captures mono 16 kHz PCM (matching Porcupine), forwards frames to the main
 * process, and builds WAV files for BYOK transcription.
 * Original work © 2026 Ravi Shankar Bera.
 */

export class MicStream {
  private ctx: AudioContext | null = null
  private proc: ScriptProcessorNode | null = null
  private stream: MediaStream | null = null

  async start(onFrame: (buf: ArrayBuffer) => void): Promise<void> {
    this.stop()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    const ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(512, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0 // never route the mic back to the speakers

    proc.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0)
      const i16 = new Int16Array(f32.length)
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]))
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      onFrame(i16.buffer)
    }

    source.connect(proc)
    proc.connect(mute)
    mute.connect(ctx.destination)

    this.stream = stream
    this.ctx = ctx
    this.proc = proc
  }

  stop(): void {
    try {
      this.proc?.disconnect()
      this.ctx?.close()
      this.stream?.getTracks().forEach((t) => t.stop())
    } catch {
      /* already stopped */
    }
    this.proc = null
    this.ctx = null
    this.stream = null
  }
}

/** Concatenate captured frames (optionally skipping leading samples) into a 16 kHz mono WAV. */
export function utteranceToWav(frames: Int16Array[], skipSamples = 0): string {
  const total = frames.reduce((n, f) => n + f.length, 0)
  const usable = Math.max(0, total - skipSamples)
  const data = new Uint8Array(usable * 2)
  let written = 0
  let toSkip = skipSamples
  const view = new DataView(data.buffer)
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      if (toSkip > 0) {
        toSkip--
        continue
      }
      if (written + 2 > data.byteLength) break
      view.setInt16(written, frame[i], true)
      written += 2
    }
  }

  const header = new ArrayBuffer(44)
  const hv = new DataView(header)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) hv.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  hv.setUint32(4, 36 + written, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  hv.setUint32(16, 16, true)
  hv.setUint16(20, 1, true) // PCM
  hv.setUint16(22, 1, true) // mono
  hv.setUint32(24, 16000, true)
  hv.setUint32(28, 16000 * 2, true)
  hv.setUint16(32, 2, true)
  hv.setUint16(34, 16, true)
  writeStr(36, 'data')
  hv.setUint32(40, written, true)

  const out = new Uint8Array(44 + written)
  out.set(new Uint8Array(header), 0)
  out.set(data.subarray(0, written), 44)

  // base64 without stack-overflow (chunked)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < out.length; i += chunk) {
    binary += String.fromCharCode(...out.subarray(i, i + chunk))
  }
  return btoa(binary)
}
