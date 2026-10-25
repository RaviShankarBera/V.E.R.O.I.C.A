/**
 * Window creation and sender validation — the security spine of Veronica AI.
 * Lessons applied from the analyzed installer (see README "Security posture"):
 * strict CSP, context isolation, sandboxed renderer, validated IPC senders,
 * no arbitrary navigation, permission gate for camera/mic only.
 * Original work © 2026 Ravi Shankar Bera.
 */
import { BrowserWindow, session, shell } from 'electron'
import path from 'node:path'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0f17',
    title: 'Veronica AI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // No renderer-initiated navigation away from the app itself.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  // External links open in the OS browser — never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

/**
 * Trust gate for every IPC message: only our own renderer (dev server or the
 * bundled file:// page) may invoke main-process methods. Anything else — a
 * compromised frame, a devtools hack, another WebContents — is rejected.
 */
export function isTrustedSender(url: string): boolean {
  if (DEV_URL) {
    try {
      const dev = new URL(DEV_URL)
      const src = new URL(url)
      return src.protocol === dev.protocol && src.host === dev.host
    } catch {
      return false
    }
  }
  return url.startsWith('file://')
}

/**
 * Permission policy: the only media permission the renderer ever needs is the
 * microphone (voice input + wake word). Everything else is denied loudly.
 */
export function installPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media'
  })
}

/**
 * Content-Security-Policy for the packaged (file://) renderer. The dev server
 * additionally gets headers from electron.vite.config.ts. No remote script,
 * no eval, no inline script — matching the hardening the analyzed app lacked.
 */
export function installCsp(): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
