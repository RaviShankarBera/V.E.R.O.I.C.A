/**
 * Event bus — main-process side push channel to the renderer.
 * Original work © 2026 Ravi Shankar Bera.
 */
import type { WebContents } from 'electron'
import { IPC_EVENT, type AppEvent } from '../shared/types'

let contents: WebContents | null = null

export function attachWebContents(wc: WebContents): void {
  contents = wc
  wc.on('destroyed', () => {
    if (contents === wc) contents = null
  })
}

export function emit(evt: AppEvent): void {
  if (contents && !contents.isDestroyed()) {
    contents.send(IPC_EVENT, evt)
  }
}
