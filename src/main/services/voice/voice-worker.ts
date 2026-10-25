/**
 * Wake-word worker — runs as a Node child process (child_process.fork sets
 * ELECTRON_RUN_AS_NODE), so the Porcupine native binding loads against plain
 * Node ABI. No Python runtime required.
 *
 * Protocol (advanced serialization):
 *   in : {type:'init', accessKey, keyword} | {type:'pcm', data} | {type:'stop'}
 *   out: {type:'ready', sampleRate, frameLength} | {type:'wake', keyword}
 *        | {type:'error', message} | {type:'stopped'}
 * Original work © 2026 Ravi Shankar Bera.
 */
import { BuiltinKeyword, Porcupine, getBuiltinKeywordPath } from '@picovoice/porcupine-node'

type InMsg =
  | { type: 'init'; accessKey: string; keyword: string }
  | { type: 'pcm'; data: ArrayBuffer | Uint8Array }
  | { type: 'stop' }

let porcupine: Porcupine | null = null
let pending = new Int16Array(0)
let keyword = 'computer'
let reportedError = false

const send = (msg: Record<string, unknown>): void => {
  try {
    process.send?.(msg)
  } catch {
    /* parent gone */
  }
}

function resolveKeywordPath(name: string): string {
  const lower = name.toLowerCase().trim().replace(/\s+/g, ' ')
  const values = Object.values(BuiltinKeyword) as unknown as string[]
  const hit = values.find((v) => v === lower || v.replace(/_/g, ' ') === lower)
  return getBuiltinKeywordPath((hit ?? 'computer') as BuiltinKeyword)
}

function release(): void {
  try {
    porcupine?.release()
  } catch {
    /* ignore */
  }
  porcupine = null
}

function toInt16(data: ArrayBuffer | Uint8Array): Int16Array {
  if (data instanceof Int16Array) return data
  const u8 =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  // fresh, aligned copy (IPC buffers may be pooled/offset)
  const copy = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  return new Int16Array(copy)
}

function feed(chunk: Int16Array): void {
  if (!porcupine) return
  const fl = porcupine.frameLength
  const merged = new Int16Array(pending.length + chunk.length)
  merged.set(pending)
  merged.set(chunk, pending.length)
  let off = 0
  try {
    while (merged.length - off >= fl && porcupine) {
      const idx = porcupine.process(merged.subarray(off, off + fl))
      off += fl
      if (idx >= 0 && !reportedError) send({ type: 'wake', keyword })
    }
  } catch (err) {
    if (!reportedError) {
      reportedError = true
      send({ type: 'error', message: `Porcupine process failed: ${(err as Error).message}` })
    }
  }
  pending = merged.slice(off)
}

process.on('message', (msg: InMsg) => {
  if (msg?.type === 'init') {
    release()
    pending = new Int16Array(0)
    reportedError = false
    keyword = msg.keyword
    try {
      const path = resolveKeywordPath(msg.keyword)
      porcupine = new Porcupine(msg.accessKey, [path], [0.55])
      send({
        type: 'ready',
        sampleRate: porcupine.sampleRate,
        frameLength: porcupine.frameLength,
        keyword: msg.keyword
      })
    } catch (err) {
      send({ type: 'error', message: (err as Error).message })
    }
  } else if (msg?.type === 'pcm') {
    feed(toInt16(msg.data))
  } else if (msg?.type === 'stop') {
    release()
    send({ type: 'stopped' })
  }
})

process.on('exit', release)
