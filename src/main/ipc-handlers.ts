import { ipcMain, BrowserWindow, app, clipboard } from 'electron'
import { spawn } from 'child_process'
import { platform } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import i18nMain, { initI18nMain } from '../shared/i18n/main'
import { rebuildTrayMenu } from './services/tray-manager'
import { checkEnvironment, checkOpenclawUpdate } from './services/env-checker'
import { checkPort, runDoctorFix } from './services/troubleshooter'
import {
  installNodeMac,
  installOpenClaw,
  installWsl,
  installNodeWsl,
  installOpenClawWsl
} from './services/installer'
import { runOnboard, readCurrentConfig, switchProvider } from './services/onboarder'
import {
  startGateway,
  stopGateway,
  restartGateway,
  getGatewayStatus,
  setGatewayLogCallback
} from './services/gateway'
import { getSupervisor } from './services/gateway-supervisor'
import { collect as collectDiagnostic } from './services/diagnostic-collector'
import { checkWslState } from './services/wsl-utils'
import { checkForUpdates, downloadUpdate, installUpdate } from './services/updater'
import { uninstallOpenClaw } from './services/uninstaller'
import { exportBackup, importBackup } from './services/backup'
import { loginOpenAICodex } from './services/oauth'

interface WizardPersistedState {
  step: string
  wslInstalled: boolean
  timestamp: number
}

const getWizardStatePath = (): string => join(app.getPath('userData'), 'wizard-state.json')
const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

const readSettings = (): Record<string, unknown> => {
  try {
    const p = getSettingsPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    /* ignore */
  }
  return {}
}

const writeSettings = (patch: Record<string, unknown>): void => {
  const settings = { ...readSettings(), ...patch }
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

export const getSavedLocale = (): string => {
  const settings = readSettings()
  if (typeof settings.language === 'string') return settings.language
  const sys = app.getLocale()
  if (sys.startsWith('ko')) return 'ko'
  if (sys.startsWith('ja')) return 'ja'
  if (sys.startsWith('zh')) return 'zh'
  return 'en'
}

export const registerIpcHandlers = (getWin: () => BrowserWindow | null): void => {
  const win = (): BrowserWindow => {
    const w = getWin()
    if (!w || w.isDestroyed()) throw new Error('No active window')
    return w
  }

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('env:check', () => checkEnvironment())
  ipcMain.handle('openclaw:check-update', () => checkOpenclawUpdate())

  // WSL-related IPC
  ipcMain.handle('wsl:check', () => checkWslState())

  ipcMain.handle('wsl:install', async (_e, prevState?: string) => {
    try {
      const result = await installWsl(win(), prevState as Parameters<typeof installWsl>[1])
      return { success: true, needsReboot: result.needsReboot, state: result.state }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  // Wizard state persistence IPC
  ipcMain.handle('wizard:save-state', (_e, state: WizardPersistedState) => {
    try {
      writeFileSync(getWizardStatePath(), JSON.stringify(state))
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('wizard:load-state', () => {
    try {
      const path = getWizardStatePath()
      if (!existsSync(path)) return null
      const state: WizardPersistedState = JSON.parse(readFileSync(path, 'utf-8'))
      // Expire after 24 hours
      if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
        unlinkSync(path)
        return null
      }
      return state
    } catch {
      return null
    }
  })

  ipcMain.handle('wizard:clear-state', () => {
    try {
      const path = getWizardStatePath()
      if (existsSync(path)) unlinkSync(path)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('install:node', async () => {
    try {
      if (platform() === 'win32') {
        await installNodeWsl(win())
      } else {
        await installNodeMac(win())
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('install:openclaw', async () => {
    try {
      if (platform() === 'win32') {
        await installOpenClawWsl(win())
      } else {
        await installOpenClaw(win())
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        win().webContents.send('install:error', msg)
      } catch {
        /* window destroyed */
      }
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    'onboard:run',
    async (
      _e,
      config: {
        provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
        apiKey?: string
        authMethod?: 'api-key' | 'oauth'
        telegramBotToken?: string
        modelId?: string
      }
    ) => {
      try {
        const result = await runOnboard(win(), config)
        // Boot the gateway through the supervisor so DoneStep sees alive
        // immediately instead of relying on its 30 s polling fallback.
        await getSupervisor()
          .start('manual')
          .catch(() => undefined)
        return { success: true, botUsername: result.botUsername }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        try {
          win().webContents.send('install:error', msg)
        } catch {
          /* window destroyed */
        }
        return { success: false, error: msg }
      }
    }
  )

  ipcMain.handle('oauth:openai-codex', async () => {
    try {
      await loginOpenAICodex(win())
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { success: false, error: msg }
    }
  })

  // Read config / switch provider
  ipcMain.handle('config:read', async () => {
    try {
      const config = await readCurrentConfig()
      return { success: true, config }
    } catch (e) {
      return { success: false, config: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'config:switch-provider',
    async (
      _e,
      config: {
        provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
        apiKey?: string
        authMethod?: 'api-key' | 'oauth'
        modelId?: string
      }
    ) => {
      try {
        await switchProvider(win(), config)
        // switchProvider already kills the daemon and (on macOS) bootstraps
        // a fresh one. Drive the supervisor lifecycle here so the renderer
        // observes a single boot transition instead of a stop/start race.
        await getSupervisor().start('manual')
        return { success: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        try {
          win().webContents.send('install:error', msg)
        } catch {
          /* window destroyed */
        }
        return { success: false, error: msg }
      }
    }
  )

  // Forward Gateway logs to renderer
  setGatewayLogCallback((msg) => {
    try {
      win().webContents.send('gateway:log', msg)
    } catch {
      /* window destroyed */
    }
  })

  ipcMain.handle('gateway:start', async () => {
    try {
      const result = await startGateway()
      const success = result.status === 'started'
      return { success, error: result.error }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:stop', async () => {
    try {
      await stopGateway()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:restart', async () => {
    try {
      const result = await restartGateway()
      const success = result.status === 'started'
      return { success, error: result.error }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gateway:status', () => getGatewayStatus())

  // Push richer supervisor events to the renderer so DoneStep + tray can
  // distinguish 'restarting' from 'failed' / 'gave_up' without polling.
  const supervisor = getSupervisor()
  const broadcast = (event: string, payload?: unknown): void => {
    try {
      win().webContents.send(event, payload)
    } catch {
      /* window destroyed */
    }
  }
  supervisor.on('status-changed', (status) => broadcast('gateway:status-changed', { status }))
  supervisor.on('restarting', (payload) => broadcast('gateway:restarting', payload))
  supervisor.on('restarted', () => broadcast('gateway:restarted'))
  supervisor.on('gave_up', (payload) => broadcast('gateway:gave-up', payload))
  supervisor.on('died', (info) => broadcast('gateway:died', info))

  // Diagnostic — collects stderr / stdout / restart history / platform info
  // into a single PII-masked text block the user can paste into the Kakao
  // group chat.
  ipcMain.handle('diagnostic:collect', async () => {
    try {
      return await collectDiagnostic()
    } catch (e) {
      return {
        timestamp: Date.now(),
        text: `<diagnostic collector failed: ${e instanceof Error ? e.message : String(e)}>`
      }
    }
  })

  ipcMain.handle('diagnostic:copy', (_e, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('troubleshoot:check-port', () => checkPort())
  ipcMain.handle('troubleshoot:doctor-fix', () => runDoctorFix(win()))

  ipcMain.handle('newsletter:subscribe', async (_e, email: string) => {
    try {
      const r = await fetch('https://easyclaw.kr/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'app' })
      })
      if (!r.ok) return { success: false }
      const data = await r.json()
      return { success: data.success !== false }
    } catch {
      return { success: false }
    }
  })

  ipcMain.on('system:reboot', () => {
    if (platform() !== 'win32') return
    const child = spawn('shutdown', ['/r', '/t', '0'], {
      shell: true,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
  })

  // Auto update IPC
  ipcMain.handle('update:check', () => {
    checkForUpdates()
    return { success: true }
  })

  ipcMain.handle('update:download', () => {
    downloadUpdate()
    return { success: true }
  })

  ipcMain.handle('update:install', () => {
    installUpdate()
    return { success: true }
  })

  // Auto launch IPC
  ipcMain.handle('autolaunch:get', () => ({
    enabled: app.getLoginItemSettings().openAtLogin
  }))

  ipcMain.handle('autolaunch:set', (_e, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
    return { success: true }
  })

  // Uninstall OpenClaw
  ipcMain.handle('uninstall:openclaw', async (_e, opts: { removeConfig: boolean }) => {
    try {
      await uninstallOpenClaw(win(), opts)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Backup / restore
  ipcMain.handle('backup:export', () => exportBackup(win()))
  ipcMain.handle('backup:import', () => importBackup(win()))

  // i18n settings
  ipcMain.handle('i18n:get-locale', () => i18nMain.language || getSavedLocale())

  const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh']

  ipcMain.handle('i18n:set-language', async (_e, lng: string) => {
    if (!SUPPORTED_LANGS.includes(lng)) {
      return { success: false, error: 'Unsupported language' }
    }
    writeSettings({ language: lng })
    await initI18nMain(lng)
    rebuildTrayMenu()
    return { success: true }
  })
}
