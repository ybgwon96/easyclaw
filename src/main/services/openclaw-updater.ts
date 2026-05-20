import { BrowserWindow, Notification } from 'electron'
import { platform } from 'os'
import { installOpenClawMacCore, installOpenClawWslCore } from './installer'
import { checkOpenclawUpdate } from './env-checker'
import { getGatewayStatus, startGateway, stopGateway } from './gateway'
import { t } from '../../shared/i18n/main'

const FIRST_CHECK_DELAY_MS = 30_000
const PERIODIC_INTERVAL_MS = 6 * 60 * 60 * 1000

type Phase = 'started' | 'progress' | 'done' | 'error'
type Payload = {
  msg?: string
  from?: string
  to?: string
  error?: string
}

let started = false
let inProgress = false
let timer: ReturnType<typeof setTimeout> | null = null

const emit = (getWin: () => BrowserWindow | null, phase: Phase, payload: Payload = {}): void => {
  const win = getWin()
  if (win && !win.isDestroyed()) {
    win.webContents.send(`openclaw:auto-update-${phase}`, payload)
  }
}

export const isOpenclawUpdating = (): boolean => inProgress

const runCheck = async (getWin: () => BrowserWindow | null): Promise<void> => {
  if (inProgress) return
  inProgress = true
  try {
    const info = await checkOpenclawUpdate()
    if (!info.currentVersion || !info.latestVersion) return
    // Use string inequality — npm `latest` tag returns stable versions only,
    // so any difference means a newer version is available. Avoids fragile
    // semver parsing with pre-release tags.
    if (info.currentVersion === info.latestVersion) return

    const from = info.currentVersion
    const to = info.latestVersion

    emit(getWin, 'started', { from, to })

    // Stop gateway first so the running process doesn't have its binary
    // replaced mid-flight (which would trigger supervisor auto-restart loops).
    const wasRunning = (await getGatewayStatus()) === 'running'
    if (wasRunning) {
      emit(getWin, 'progress', { msg: 'Stopping Gateway...' })
      await stopGateway().catch(() => {})
    }

    const installer =
      platform() === 'win32'
        ? (cb: (m: string) => void): Promise<void> => installOpenClawWslCore(cb)
        : installOpenClawMacCore
    await installer((msg) => emit(getWin, 'progress', { msg }))

    if (wasRunning) {
      emit(getWin, 'progress', { msg: t('done.restartingGw') })
      const result = await startGateway()
      if (result.status !== 'started') {
        emit(getWin, 'error', {
          error: result.error ?? 'Gateway failed to start after update'
        })
        return
      }
    }

    emit(getWin, 'done', { from, to })

    if (Notification.isSupported()) {
      new Notification({
        title: 'EasyClaw',
        body: t('tray.notifyOcUpdated', { from, to })
      }).show()
    }
  } catch (e) {
    emit(getWin, 'error', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    inProgress = false
  }
}

export const startOpenclawAutoUpdate = (getWin: () => BrowserWindow | null): void => {
  if (started) return
  started = true

  const scheduleNext = (): void => {
    timer = setTimeout(async () => {
      await runCheck(getWin)
      scheduleNext()
    }, PERIODIC_INTERVAL_MS)
  }

  timer = setTimeout(async () => {
    await runCheck(getWin)
    scheduleNext()
  }, FIRST_CHECK_DELAY_MS)
}

export const triggerOpenclawUpdateNow = (getWin: () => BrowserWindow | null): Promise<void> =>
  runCheck(getWin)

export const stopOpenclawAutoUpdate = (): void => {
  if (timer) clearTimeout(timer)
  timer = null
  started = false
}
