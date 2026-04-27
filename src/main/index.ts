import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers, getSavedLocale } from './ipc-handlers'
import { createTray, startPolling, destroyTray } from './services/tray-manager'
import { setupAutoUpdater, checkForUpdates } from './services/updater'
import { startGateway } from './services/gateway'
import { getSupervisor } from './services/gateway-supervisor'
import { migrateGatewayPlist } from './services/onboarder'
import {
  flush as flushGatewayLog,
  writeLine as writeGatewayLog
} from './services/gateway-log-rotator'
import { initI18nMain } from '../shared/i18n/main'
import icon from '../../resources/icon.png?asset'

let ipcRegistered = false
let mainWindow: BrowserWindow | null = null
let isQuitting = false

const getWin = (): BrowserWindow | null => mainWindow

function createWindow(): void {
  const startHidden =
    app.getLoginItemSettings().wasOpenedAsHidden || process.argv.includes('--hidden')

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Close window → stay in tray (not a real quit)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (['https:', 'tg:'].includes(url.protocol)) {
        shell.openExternal(details.url)
      }
    } catch {
      /* invalid URL — ignore */
    }
    return { action: 'deny' }
  })

  if (!ipcRegistered) {
    registerIpcHandlers(getWin)
    ipcRegistered = true
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Auto-start Gateway when launched hidden
  if (startHidden) {
    startGateway().catch(() => {})
  }
}

let cleanupRan = false

const runQuitCleanup = async (): Promise<void> => {
  if (cleanupRan) return
  cleanupRan = true
  writeGatewayLog('meta', 'app quit — cleanup start')
  try {
    const stopPromise = getSupervisor().stop()
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000))
    await Promise.race([stopPromise, timeoutPromise])
  } catch {
    /* best effort */
  }
  flushGatewayLog()
  writeGatewayLog('meta', 'app quit — cleanup done')
}

app.on('before-quit', (event) => {
  isQuitting = true
  if (cleanupRan) return
  event.preventDefault()
  void runQuitCleanup().finally(() => {
    app.exit(0)
  })
})

app.whenReady().then(async () => {
  await initI18nMain(getSavedLocale())
  electronApp.setAppUserModelId('com.easyclaw.app')

  // One-shot launchd plist migration: adds StandardOut/Err paths so daemon
  // crashes leave a trail under userData/logs/. No-op if already patched
  // or on Windows.
  void migrateGatewayPlist().catch(() => {})

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // System tray
  createTray({
    getWin,
    onQuit: async () => {
      isQuitting = true
      app.quit()
    }
  })
  startPolling()

  // Auto update
  setupAutoUpdater(getWin)
  setTimeout(checkForUpdates, 5000)

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

// Stay in tray — keep app alive even when all windows are closed
app.on('window-all-closed', () => {
  // Do not quit in tray mode
})

app.on('quit', () => {
  destroyTray()
})
