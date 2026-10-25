/**
 * Veronica AI preload — the ONLY bridge between renderer and main.
 * Original work © 2026 Ravi Shankar Bera. MIT licensed.
 *
 * Exposes a single typed request channel plus an event subscription.
 * The renderer gets no direct ipcRenderer/node access (contextIsolation + sandbox).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENT, IPC_PCM, IPC_REQUEST, type AppEvent, type RequestEnvelope, type ResponseEnvelope } from '../shared/types'

const api = {
  request(method: string, payload: unknown): Promise<ResponseEnvelope<unknown>> {
    const envelope: RequestEnvelope = { method, payload }
    return ipcRenderer.invoke(IPC_REQUEST, envelope)
  },
  sendPcm(data: ArrayBuffer): void {
    // Fire-and-forget audio frames for the wake-word pipeline.
    ipcRenderer.send(IPC_PCM, data)
  },
  onEvent(cb: (evt: AppEvent) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, evt: AppEvent) => {
      try {
        cb(evt)
      } catch {
        /* renderer listener errors must not break the bridge */
      }
    }
    ipcRenderer.on(IPC_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_EVENT, listener)
  }
}

contextBridge.exposeInMainWorld('veronica', api)
