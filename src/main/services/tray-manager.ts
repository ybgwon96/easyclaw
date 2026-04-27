import { Tray, Menu, nativeImage, Notification, BrowserWindow, clipboard } from 'electron'
import { join } from 'path'
import { getGatewayStatus, startGateway, stopGateway } from './gateway'
import { getSupervisor, type GatewayStatus } from './gateway-supervisor'
import { collect as collectDiagnostic } from './diagnostic-collector'
import { t } from '../../shared/i18n/main'

let tray: Tray | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastStatus: TrayStatus = 'stopped'
let lastNotifyMs = 0
let supervisorSubscribed = false

type TrayStatus = 'running' | 'restarting' | 'failed' | 'stopped'

interface TrayDeps {
  getWin: () => BrowserWindow | null
  onQuit: () => void
}

let deps: TrayDeps | null = null

const createTrayIcon = (): Electron.NativeImage => {
  if (process.platform === 'darwin') {
    const templatePath = join(__dirname, '../../resources/trayIconTemplate.png')
    try {
      const img = nativeImage.createFromPath(templatePath)
      if (!img.isEmpty()) {
        img.setTemplateImage(true)
        return img
      }
    } catch {
      // fallback below
    }
  }
  // Fallback: use app icon resized
  const iconPath = join(__dirname, '../../resources/icon.png')
  const img = nativeImage.createFromPath(iconPath)
  return img.resize({ width: 16, height: 16 })
}

const statusLabel = (status: TrayStatus): string => {
  switch (status) {
    case 'running':
      return t('tray.gwRunning')
    case 'restarting':
      return t('tray.gwRestarting')
    case 'failed':
      return t('tray.gwFailed')
    case 'stopped':
    default:
      return t('tray.gwStopped')
  }
}

const tooltipFor = (status: TrayStatus): string =>
  status === 'running' ? t('tray.tooltipRunning') : t('tray.tooltipStopped')

const buildMenu = (status: TrayStatus): Menu =>
  Menu.buildFromTemplate([
    {
      label: t('tray.open'),
      click: () => {
        const win = deps?.getWin()
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    { type: 'separator' },
    { label: statusLabel(status), enabled: false },
    {
      label: t('tray.gwStart'),
      enabled: status !== 'running' && status !== 'restarting',
      click: async () => {
        try {
          await startGateway()
        } catch {
          /* status will be reflected in refreshStatus */
        }
        await refreshStatus()
      }
    },
    {
      label: t('tray.gwStop'),
      enabled: status === 'running' || status === 'restarting',
      click: async () => {
        await stopGateway()
        await refreshStatus()
      }
    },
    { type: 'separator' },
    {
      label: t('tray.copyDiagnostic'),
      click: async () => {
        try {
          const report = await collectDiagnostic()
          clipboard.writeText(report.text)
          notify('EasyClaw', '진단 정보를 클립보드에 복사했습니다.')
        } catch {
          /* ignore */
        }
      }
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        deps?.onQuit()
      }
    }
  ])

const computeTrayStatus = (
  pollResult: 'running' | 'stopped',
  supervisorStatus: GatewayStatus
): TrayStatus => {
  if (supervisorStatus === 'restarting') return 'restarting'
  if (supervisorStatus === 'gave_up' || supervisorStatus === 'failed') return 'failed'
  return pollResult
}

const refreshStatus = async (): Promise<void> => {
  const pollResult = await getGatewayStatus()
  const supervisorStatus = getSupervisor().getStatus()
  const status = computeTrayStatus(pollResult, supervisorStatus)
  updateMenu(status)

  if (status !== lastStatus) {
    lastStatus = status
    if (status === 'running') notify('Gateway', t('tray.notifyRunning'))
    else if (status === 'stopped') notify('Gateway', t('tray.notifyStopped'))
  }
}

const updateMenu = (status: TrayStatus): void => {
  if (!tray) return
  tray.setContextMenu(buildMenu(status))
  tray.setToolTip(tooltipFor(status))
}

const NOTIFY_THROTTLE_MS = 5 * 60 * 1000
const notify = (title: string, body: string): void => {
  const now = Date.now()
  if (now - lastNotifyMs < NOTIFY_THROTTLE_MS) return
  lastNotifyMs = now
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
}

const subscribeSupervisor = (): void => {
  if (supervisorSubscribed) return
  supervisorSubscribed = true
  const supervisor = getSupervisor()
  supervisor.on('died', () => {
    notify('Gateway', t('tray.notifyDied'))
    void refreshStatus()
  })
  supervisor.on('gave_up', () => {
    // Bypass throttle for gave_up — user must see this.
    lastNotifyMs = 0
    notify('Gateway', t('tray.notifyGaveUp'))
    const win = deps?.getWin()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
    void refreshStatus()
  })
  supervisor.on('status-changed', () => void refreshStatus())
}

export const createTray = (trayDeps: TrayDeps): void => {
  deps = trayDeps
  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('EasyClaw')
  updateMenu('stopped')
  subscribeSupervisor()

  if (process.platform === 'darwin') {
    tray.on('click', () => {
      const win = deps?.getWin()
      if (win) {
        win.show()
        win.focus()
      }
    })
  }
}

export const rebuildTrayMenu = (): void => {
  updateMenu(lastStatus)
}

export const startPolling = (): void => {
  if (pollTimer) return
  // Run once immediately, then poll every 10 seconds
  refreshStatus()
  pollTimer = setInterval(refreshStatus, 10_000)
}

export const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export const destroyTray = (): void => {
  stopPolling()
  if (tray) {
    tray.destroy()
    tray = null
  }
  deps = null
}

export const isGatewayRunning = (): boolean => lastStatus === 'running'
