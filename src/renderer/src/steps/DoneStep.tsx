import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import LobsterLogo from '../components/LobsterLogo'
import Button from '../components/Button'
import LogViewer from '../components/LogViewer'
import ManagementModal from '../components/ManagementModal'
import ProviderSwitchModal from '../components/ProviderSwitchModal'
import DiagnosticModal from '../components/DiagnosticModal'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useManagement } from '../hooks/useManagement'

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000 // 30 min

export default function DoneStep({
  botUsername,
  onTroubleshoot,
  onUninstallDone
}: {
  botUsername?: string
  onTroubleshoot?: () => void
  onUninstallDone?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('management')
  const [status, setStatus] = useState<'starting' | 'running' | 'stopped'>('starting')
  const [gatewayHealth, setGatewayHealth] = useState<'healthy' | 'restarting' | 'failed'>('healthy')
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [currentProvider, setCurrentProvider] = useState<string | undefined>()
  const [showProviderModal, setShowProviderModal] = useState(false)

  // OpenClaw update state
  const [openclawUpdate, setOpenclawUpdate] = useState<{
    current: string
    latest: string
  } | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateLogs, setUpdateLogs] = useState<string[]>([])
  const updateCheckedRef = useRef(false)

  const tRef = useRef<TFunction>(t)
  tRef.current = t

  const { uninstall, backup } = useManagement(setStatus)

  // Check for OpenClaw updates
  const checkOpenclawUpdate = useCallback(async () => {
    try {
      const info = await window.electronAPI.openclaw.checkUpdate()
      if (info.currentVersion && info.latestVersion && info.currentVersion !== info.latestVersion) {
        setOpenclawUpdate({ current: info.currentVersion, latest: info.latestVersion })
      } else {
        setOpenclawUpdate(null)
      }
    } catch {
      /* ignore network errors */
    }
  }, [])

  // Check once when Gateway is running + every 30 min
  useEffect(() => {
    if (status !== 'running') return

    if (!updateCheckedRef.current) {
      updateCheckedRef.current = true
      checkOpenclawUpdate()
    }

    const timer = setInterval(checkOpenclawUpdate, UPDATE_CHECK_INTERVAL)
    return () => clearInterval(timer)
  }, [status, checkOpenclawUpdate])

  // Execute OpenClaw update
  const handleOpenclawUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateLogs([])

    const unsubProgress = window.electronAPI.install.onProgress((msg) => {
      setUpdateLogs((prev) => [...prev, msg])
    })
    const unsubError = window.electronAPI.install.onError((msg) => {
      setUpdateLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg })])
    })

    try {
      const result = await window.electronAPI.install.openclaw()
      if (result.success) {
        setUpdateLogs((prev) => [...prev, tRef.current('done.restartingGw')])
        await window.electronAPI.gateway.restart()
        setStatus('running')
        await checkOpenclawUpdate()
      }
    } finally {
      unsubProgress()
      unsubError()
      setUpdating(false)
    }
  }, [checkOpenclawUpdate])

  // Load auto launch settings
  useEffect(() => {
    window.electronAPI.autoLaunch.get().then((r) => setAutoLaunch(r.enabled))
  }, [])

  // Read current provider/model
  const loadCurrentConfig = useCallback(() => {
    window.electronAPI.config.read().then((r) => {
      if (r.success && r.config) {
        setCurrentModel(r.config.model || null)
        setCurrentProvider(r.config.provider)
      }
    })
  }, [])

  useEffect(() => {
    loadCurrentConfig()
  }, [loadCurrentConfig])

  const toggleAutoLaunch = async (): Promise<void> => {
    const next = !autoLaunch
    await window.electronAPI.autoLaunch.set(next)
    setAutoLaunch(next)
  }

  useEffect(() => {
    const unsub = window.electronAPI.gateway.onLog((msg) => {
      setLogs((prev) => [...prev, msg])
    })
    return unsub
  }, [])

  // Subscribe to Gateway status changes from tray
  useEffect(() => {
    const unsub = window.electronAPI.gateway.onStatusChanged(({ status: s }) => {
      setStatus(s === 'running' ? 'running' : 'stopped')
      if (s === 'running') setGatewayHealth('healthy')
      else if (s === 'restarting') setGatewayHealth('restarting')
      else if (s === 'failed' || s === 'gave_up') setGatewayHealth('failed')
    })
    return unsub
  }, [])

  // Subscribe to richer supervisor events for restart UX + failure modal
  useEffect(() => {
    const unsubRestarting = window.electronAPI.gateway.onRestarting(() => {
      setGatewayHealth('restarting')
    })
    const unsubRestarted = window.electronAPI.gateway.onRestarted(() => {
      setGatewayHealth('healthy')
    })
    const unsubGaveUp = window.electronAPI.gateway.onGaveUp(() => {
      setGatewayHealth('failed')
      setShowDiagnosticModal(true)
    })
    return () => {
      unsubRestarting()
      unsubRestarted()
      unsubGaveUp()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const poll = async (): Promise<void> => {
      for (let i = 0; i < 15; i++) {
        if (cancelled) return
        const s = await window.electronAPI.gateway.status()
        if (cancelled) return
        if (s === 'running') {
          setStatus('running')
          return
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (cancelled) return
      const r = await window.electronAPI.gateway.start()
      if (!cancelled) {
        setStatus(r.success ? 'running' : 'stopped')
        if (!r.success) {
          setHasError(true)
          if (r.error) {
            setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
            setShowLogs(true)
          }
        }
      }
    }
    poll()

    return () => {
      cancelled = true
    }
  }, [])

  const handleStop = async (): Promise<void> => {
    await window.electronAPI.gateway.stop()
    setStatus('stopped')
  }

  const handleStart = async (): Promise<void> => {
    setStatus('starting')
    setLogs([])
    setHasError(false)
    const r = await window.electronAPI.gateway.start()
    setStatus(r.success ? 'running' : 'stopped')
    if (!r.success) {
      setHasError(true)
      if (r.error) {
        setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
        setShowLogs(true)
      }
    }
  }

  const handleRestart = useCallback(async (): Promise<void> => {
    setStatus('starting')
    setLogs([])
    setHasError(false)
    const r = await window.electronAPI.gateway.restart()
    setStatus(r.success ? 'running' : 'stopped')
    if (!r.success) {
      setHasError(true)
      if (r.error) {
        setLogs((prev) => [...prev, tRef.current('done.errorPrefix', { msg: r.error })])
        setShowLogs(true)
      }
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-10 gap-3 overflow-hidden">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      {/* Logo + status */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div
            className={`absolute inset-0 rounded-full blur-2xl scale-125 transition-colors duration-700 ${
              status === 'running' ? 'bg-success/10' : 'bg-primary/10'
            }`}
          />
          <LobsterLogo
            state={status === 'running' ? 'success' : status === 'starting' ? 'loading' : 'idle'}
            size={44}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                status === 'running'
                  ? 'bg-success'
                  : status === 'starting'
                    ? 'bg-warning'
                    : 'bg-text-muted/40'
              }`}
              style={
                status !== 'stopped'
                  ? {
                      animation: 'glow-pulse 2s infinite',
                      color: status === 'running' ? 'var(--color-success)' : 'var(--color-warning)'
                    }
                  : {}
              }
            />
            <span className="text-sm font-bold tracking-wide">
              {status === 'running'
                ? t('done.gatewayRunning')
                : status === 'starting'
                  ? t('done.gatewayStarting')
                  : t('done.gatewayStopped')}
            </span>
          </div>
          {currentModel && (
            <button
              onClick={() => setShowProviderModal(true)}
              className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-[11px] text-text-muted">{t('done.aiModel')}</span>
              <span className="text-[11px] font-bold text-primary">{currentModel}</span>
              <span className="text-[10px] text-text-muted/60">{t('done.changeModel')}</span>
            </button>
          )}
        </div>
      </div>

      {/* OpenClaw update banner */}
      {(openclawUpdate || updating) && (
        <div className="w-full max-w-md flex items-center gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500/15 via-blue-500/10 to-blue-500/15 border border-blue-500/30">
          <span className="text-base">{updating ? '⏳' : '🔄'}</span>
          <div className="flex-1 min-w-0">
            {updating ? (
              <div>
                <span className="text-[12px] font-bold">{t('common:status.updating')}</span>
                {updateLogs.length > 0 && (
                  <p className="text-[11px] text-text-muted/70 truncate">
                    {updateLogs[updateLogs.length - 1]}
                  </p>
                )}
              </div>
            ) : (
              <span className="text-[12px] font-bold">
                {t('done.ocUpdateAvailable', { latest: openclawUpdate!.latest })}
                <span className="text-text-muted/50 font-normal ml-1">
                  ({t('done.ocCurrentVersion', { current: openclawUpdate!.current })})
                </span>
              </span>
            )}
          </div>
          {!updating && (
            <button
              onClick={handleOpenclawUpdate}
              className="px-3 py-1 text-[11px] font-bold rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all duration-200 cursor-pointer whitespace-nowrap"
            >
              {t('common:button.update')}
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {status === 'running' && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              const url = botUsername ? `tg://resolve?domain=${botUsername}` : 'tg://'
              window.open(url, '_blank')
            }}
          >
            {t('done.openTelegram')}
          </Button>
        )}
        {status === 'running' ? (
          <>
            <Button variant="secondary" size="sm" onClick={handleRestart}>
              {t('done.restartBtn')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleStop}>
              {t('done.stopBtn')}
            </Button>
          </>
        ) : status === 'stopped' ? (
          <Button variant="secondary" size="sm" onClick={handleStart}>
            {t('done.startBtn')}
          </Button>
        ) : null}
      </div>

      {/* Gateway logs */}
      {logs.length > 0 && (
        <div className="w-full max-w-sm">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="text-[11px] text-text-muted/60 hover:text-text-muted transition-colors mb-1"
          >
            {showLogs ? t('done.hideLog') : t('done.showLog')}
            {hasError && <span className="ml-1.5 text-error">{t('done.errorDetected')}</span>}
          </button>
          {showLogs && <LogViewer lines={logs} />}
        </div>
      )}

      {/* ─── Star + KakaoTalk chat banner ─── */}
      <div className="w-full max-w-md grid grid-cols-2 gap-2">
        <button
          onClick={() => window.open('https://github.com/ybgwon96/easyclaw', '_blank')}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl cursor-pointer bg-white/5 border border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200"
        >
          <span className="text-lg">⭐</span>
          <div className="flex-1 text-left">
            <span className="text-sm font-bold">Star on GitHub</span>
            <p className="text-[11px] text-text-muted/70">{t('done.starDesc')}</p>
          </div>
        </button>
        <button
          onClick={() => window.open('https://open.kakao.com/o/gbBkPehi', '_blank')}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl cursor-pointer bg-white/5 border border-glass-border hover:border-primary/40 hover:bg-white/8 transition-all duration-200"
        >
          <span className="text-lg">💬</span>
          <div className="flex-1 text-left">
            <span className="text-sm font-bold">{t('done.kakaoChat')}</span>
            <p className="text-[11px] text-text-muted/70">{t('done.kakaoChatDesc')}</p>
          </div>
        </button>
      </div>

      {/* ─── Action grid (3 columns) ─── */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2">
        <button
          onClick={toggleAutoLaunch}
          className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">⚙️</span>
          <span className="text-[11px] font-bold flex-1 text-left">{t('done.autoLaunch')}</span>
          <div
            className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-200 ${
              autoLaunch ? 'bg-primary' : 'bg-white/15'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                autoLaunch ? 'translate-x-3.5' : 'translate-x-0'
              }`}
            />
          </div>
        </button>
        {onTroubleshoot && (
          <button
            onClick={onTroubleshoot}
            className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
          >
            <span className="text-sm">🔧</span>
            <span className="text-[11px] font-bold flex-1 text-left">{t('done.troubleshoot')}</span>
          </button>
        )}
        <button
          onClick={backup.execute}
          className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">📦</span>
          <span className="text-[11px] font-bold flex-1 text-left">{t('done.backup')}</span>
        </button>
        <button
          onClick={backup.openRestore}
          className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">📥</span>
          <span className="text-[11px] font-bold flex-1 text-left">{t('done.restore')}</span>
        </button>
        <button
          onClick={() => setShowDiagnosticModal(true)}
          className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-primary/40 transition-all duration-200"
        >
          <span className="text-sm">🔧</span>
          <span className="text-[11px] font-bold flex-1 text-left">{t('done.copyDiagnostic')}</span>
        </button>
        <button
          onClick={uninstall.open}
          className="glass-card flex items-center gap-2 px-3 py-2 cursor-pointer hover:border-error/40 transition-all duration-200"
        >
          <span className="text-sm">🗑️</span>
          <span className="text-[11px] font-bold flex-1 text-left text-error/80">
            {t('done.delete')}
          </span>
        </button>
      </div>

      {/* ─── Auto-restart / failure banner ─── */}
      {gatewayHealth === 'restarting' && (
        <div className="w-full max-w-md bg-warning/10 border border-warning/30 rounded-md px-3 py-2">
          <p className="text-xs text-warning">{t('done.gatewayRestarting')}</p>
        </div>
      )}
      {gatewayHealth === 'failed' && (
        <div className="w-full max-w-md bg-error/10 border border-error/30 rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-error">{t('done.gatewayFailed')}</p>
          <Button variant="secondary" size="sm" onClick={() => setShowDiagnosticModal(true)}>
            {t('done.copyDiagnostic')}
          </Button>
        </div>
      )}

      <DiagnosticModal
        open={showDiagnosticModal}
        onClose={() => setShowDiagnosticModal(false)}
        onRetry={async () => {
          setShowDiagnosticModal(false)
          setGatewayHealth('healthy')
          setStatus('starting')
          const r = await window.electronAPI.gateway.start()
          setStatus(r.success ? 'running' : 'stopped')
          if (!r.success) setGatewayHealth('failed')
        }}
      />

      {/* ─── Uninstall modal ─── */}
      {uninstall.modal && (
        <ManagementModal
          title={t('uninstall.title')}
          phase={uninstall.modal}
          message={uninstall.progress}
          errorMsg={uninstall.error}
          onClose={() => {
            const wasDone = uninstall.modal === 'done'
            uninstall.close()
            if (wasDone) onUninstallDone?.()
          }}
        >
          <div className="space-y-3">
            <p className="text-sm text-text-muted">{t('uninstall.desc')}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={uninstall.removeConfig}
                onChange={(e) => uninstall.setRemoveConfig(e.target.checked)}
                className="w-4 h-4 rounded border-glass-border accent-primary"
              />
              <span className="text-sm">{t('uninstall.removeConfig')}</span>
            </label>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={uninstall.close}>
                {t('common:button.cancel')}
              </Button>
              <button
                onClick={uninstall.execute}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-error/20 text-error border border-error/30 hover:bg-error/30 transition-all duration-200 cursor-pointer"
              >
                {t('common:button.delete')}
              </button>
            </div>
          </div>
        </ManagementModal>
      )}

      {/* ─── Restore modal ─── */}
      {backup.restoreModal && (
        <ManagementModal
          title={t('backupRestore.restoreTitle')}
          phase={backup.restoreModal}
          message={backup.restoreMsg}
          errorMsg={backup.restoreMsg}
          onClose={backup.closeRestore}
        >
          <div className="space-y-3">
            <p className="text-sm text-text-muted">{t('backupRestore.restoreDesc')}</p>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={backup.closeRestore}>
                {t('common:button.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={backup.executeRestore}>
                {t('backupRestore.selectFile')}
              </Button>
            </div>
          </div>
        </ManagementModal>
      )}

      {/* ─── Backup modal ─── */}
      {backup.backupModal && backup.backupModal !== 'confirm' && (
        <ManagementModal
          title={t('done.settingsBackup')}
          phase={backup.backupModal}
          message={backup.backupMsg}
          errorMsg={backup.backupMsg}
          onClose={backup.closeBackup}
        />
      )}

      {/* ─── Provider switch modal ─── */}
      {showProviderModal && (
        <ProviderSwitchModal
          currentProvider={currentProvider}
          currentModel={currentModel || undefined}
          onClose={() => setShowProviderModal(false)}
          onSuccess={() => {
            loadCurrentConfig()
            // Gateway restart is handled by IPC handler (config:switch-provider)
            setStatus('starting')
            setTimeout(async () => {
              const s = await window.electronAPI.gateway.status()
              setStatus(s === 'running' ? 'running' : 'stopped')
            }, 3000)
          }}
        />
      )}
    </div>
  )
}
