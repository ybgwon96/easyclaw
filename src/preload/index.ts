import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  env: {
    check: (): Promise<{
      os: 'macos' | 'windows' | 'linux'
      nodeInstalled: boolean
      nodeVersion: string | null
      nodeVersionOk: boolean
      openclawInstalled: boolean
      openclawVersion: string | null
      openclawLatestVersion: string | null
      wslState?:
        | 'not_available'
        | 'not_installed'
        | 'needs_reboot'
        | 'no_distro'
        | 'not_initialized'
        | 'ready'
    }> => ipcRenderer.invoke('env:check')
  },
  install: {
    node: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('install:node'),
    openclaw: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('install:openclaw'),
    onProgress: (cb: (msg: string) => void): (() => void) => {
      const handler = (_: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('install:progress', handler)
      return () => ipcRenderer.removeListener('install:progress', handler)
    },
    onError: (cb: (msg: string) => void): (() => void) => {
      const handler = (_: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('install:error', handler)
      return () => ipcRenderer.removeListener('install:error', handler)
    }
  },
  onboard: {
    run: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      telegramBotToken?: string
      modelId?: string
    }): Promise<{ success: boolean; error?: string; botUsername?: string }> =>
      ipcRenderer.invoke('onboard:run', config)
  },
  oauth: {
    loginCodex: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('oauth:openai-codex')
  },
  reboot: (): void => ipcRenderer.send('system:reboot'),
  gateway: {
    start: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('gateway:start'),
    stop: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('gateway:stop'),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('gateway:restart'),
    status: (): Promise<'running' | 'stopped'> => ipcRenderer.invoke('gateway:status'),
    onLog: (cb: (msg: string) => void): (() => void) => {
      const handler = (_: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('gateway:log', handler)
      return () => ipcRenderer.removeListener('gateway:log', handler)
    },
    onStatusChanged: (
      cb: (payload: {
        status: 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'failed' | 'gave_up'
      }) => void
    ): (() => void) => {
      const handler = (
        _: unknown,
        payload: {
          status: 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'failed' | 'gave_up'
        }
      ): void => cb(payload)
      ipcRenderer.on('gateway:status-changed', handler)
      return () => ipcRenderer.removeListener('gateway:status-changed', handler)
    },
    onRestarting: (cb: (payload: { attempt: number; delayMs: number }) => void): (() => void) => {
      const handler = (_: unknown, p: { attempt: number; delayMs: number }): void => cb(p)
      ipcRenderer.on('gateway:restarting', handler)
      return () => ipcRenderer.removeListener('gateway:restarting', handler)
    },
    onRestarted: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('gateway:restarted', handler)
      return () => ipcRenderer.removeListener('gateway:restarted', handler)
    },
    onGaveUp: (cb: (payload: { attempts: number }) => void): (() => void) => {
      const handler = (_: unknown, p: { attempts: number }): void => cb(p)
      ipcRenderer.on('gateway:gave-up', handler)
      return () => ipcRenderer.removeListener('gateway:gave-up', handler)
    },
    onDied: (cb: (info: { code: number | null; ts: number }) => void): (() => void) => {
      const handler = (_: unknown, info: { code: number | null; ts: number }): void => cb(info)
      ipcRenderer.on('gateway:died', handler)
      return () => ipcRenderer.removeListener('gateway:died', handler)
    }
  },
  diagnostic: {
    collect: (): Promise<{ timestamp: number; text: string }> =>
      ipcRenderer.invoke('diagnostic:collect'),
    copy: (text: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('diagnostic:copy', text)
  },
  troubleshoot: {
    checkPort: (): Promise<{ inUse: boolean; pid?: string }> =>
      ipcRenderer.invoke('troubleshoot:check-port'),
    doctorFix: (): Promise<{ success: boolean }> => ipcRenderer.invoke('troubleshoot:doctor-fix')
  },
  wsl: {
    check: (): Promise<
      'not_available' | 'not_installed' | 'needs_reboot' | 'no_distro' | 'not_initialized' | 'ready'
    > => ipcRenderer.invoke('wsl:check'),
    install: (
      prevState?: string
    ): Promise<{ success: boolean; needsReboot?: boolean; state?: string; error?: string }> =>
      ipcRenderer.invoke('wsl:install', prevState)
  },
  wizard: {
    saveState: (state: {
      step: string
      wslInstalled: boolean
      timestamp: number
    }): Promise<{ success: boolean }> => ipcRenderer.invoke('wizard:save-state', state),
    loadState: (): Promise<{
      step: string
      wslInstalled: boolean
      timestamp: number
    } | null> => ipcRenderer.invoke('wizard:load-state'),
    clearState: (): Promise<{ success: boolean }> => ipcRenderer.invoke('wizard:clear-state')
  },
  newsletter: {
    subscribe: (email: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('newsletter:subscribe', email)
  },
  update: {
    check: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:check'),
    download: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:download'),
    install: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:install'),
    onAvailable: (cb: (info: { version: string }) => void): (() => void) => {
      const handler = (_: unknown, info: { version: string }): void => cb(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onProgress: (cb: (percent: number) => void): (() => void) => {
      const handler = (_: unknown, p: number): void => cb(p)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
    onDownloaded: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onError: (cb: (msg: string) => void): (() => void) => {
      const handler = (_: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    }
  },
  config: {
    read: (): Promise<{
      success: boolean
      config: { provider?: string; model?: string; hasTelegram?: boolean } | null
      error?: string
    }> => ipcRenderer.invoke('config:read'),
    switchProvider: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      modelId?: string
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('config:switch-provider', config)
  },
  openclaw: {
    checkUpdate: (): Promise<{ currentVersion: string | null; latestVersion: string | null }> =>
      ipcRenderer.invoke('openclaw:check-update')
  },
  autoLaunch: {
    get: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke('autolaunch:get'),
    set: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('autolaunch:set', enabled)
  },
  uninstall: {
    openclaw: (opts: { removeConfig: boolean }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('uninstall:openclaw', opts),
    onProgress: (cb: (msg: string) => void): (() => void) => {
      const handler = (_: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('uninstall:progress', handler)
      return () => ipcRenderer.removeListener('uninstall:progress', handler)
    }
  },
  backup: {
    export: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:export'),
    import: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('backup:import')
  },
  i18n: {
    getLocale: (): Promise<string> => ipcRenderer.invoke('i18n:get-locale'),
    setLanguage: (lng: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('i18n:set-language', lng)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
