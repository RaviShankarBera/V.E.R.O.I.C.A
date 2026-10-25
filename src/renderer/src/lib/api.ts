/**
 * Typed IPC facade — renderer side. All calls funnel through the preload
 * allowlist; errors arrive as thrown Error with the main-process message.
 */
import type { AppEvent, MethodMap, MethodName } from '@shared/types'

export async function req<K extends MethodName>(
  method: K,
  payload?: MethodMap[K]['req']
): Promise<MethodMap[K]['res']> {
  const res = await window.veronica.request(method, payload as never)
  if (!res.ok) throw new Error(res.error)
  return res.data as MethodMap[K]['res']
}

export function onEvent(cb: (evt: AppEvent) => void): () => void {
  return window.veronica.onEvent(cb)
}

export function sendPcm(buf: ArrayBuffer): void {
  window.veronica.sendPcm(buf)
}

export function bytes(n: number): string {
  if (n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
