/**
 * Veronica AI — Electron main process entry point.
 * Original work © 2026 Ravi Shankar Bera. MIT licensed.
 */
import { app } from 'electron'
import path from 'node:path'
import { attachWebContents } from './bus'
import { installRouter } from './router'
import { createRegistry, type AppRegistry } from './services/registry'
import { createMainWindow, installCsp, installPermissionPolicy } from './security'

let registry: AppRegistry | null = null

// Single instance — one Veronica per session.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.ravishankarbera.veronica')

  await app.whenReady()

  installCsp()
  installPermissionPolicy()

  const reg = createRegistry(app.getPath('userData'))
  await reg.keys.init()
  registry = reg
  installRouter(reg)

  const win = createMainWindow()
  attachWebContents(win.webContents)

  win.on('closed', () => {
    reg.confirm.cancelAll()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    await win.loadURL(rendererUrl)
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Background machinery — agentic tasks + any enabled integrations.
  reg.tasks.start()
  void reg.integrations.startAll().catch(() => {
    /* status events already surface failures */
  })

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Best-effort teardown of child processes and sockets.
  try {
    registry?.tasks.stop()
    registry?.voice.shutdown()
    registry?.confirm.cancelAll()
    void registry?.browser.close()
  } catch {
    /* shutting down anyway */
  }
})
