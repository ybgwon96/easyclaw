type WslState =
  | 'not_available'
  | 'not_installed'
  | 'needs_reboot'
  | 'no_distro'
  | 'not_initialized'
  | 'ready'

interface WizardPersistedState {
  step: string
  wslInstalled: boolean
  timestamp: number
}

interface ElectronAPI {
  version: () => Promise<string>
  env: {
    check: () => Promise<{
      os: 'macos' | 'windows' | 'linux'
      nodeInstalled: boolean
      nodeVersion: string | null
      nodeVersionOk: boolean
      openclawInstalled: boolean
      openclawVersion: string | null
      openclawLatestVersion: string | null
      wslState?: WslState
    }>
  }
  install: {
    node: () => Promise<{ success: boolean; error?: string }>
    openclaw: () => Promise<{ success: boolean; error?: string }>
    onProgress: (cb: (msg: string) => void) => () => void
    onError: (cb: (msg: string) => void) => () => void
  }
  onboard: {
    run: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      telegramBotToken?: string
      modelId?: string
    }) => Promise<{ success: boolean; error?: string; botUsername?: string }>
  }
  oauth: {
    loginCodex: () => Promise<{ success: boolean; error?: string }>
  }
  reboot: () => void
  gateway: {
    start: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    restart: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<'running' | 'stopped'>
    onLog: (cb: (msg: string) => void) => () => void
    onStatusChanged: (
      cb: (payload: {
        status: 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'failed' | 'gave_up'
      }) => void
    ) => () => void
    onRestarting: (cb: (payload: { attempt: number; delayMs: number }) => void) => () => void
    onRestarted: (cb: () => void) => () => void
    onGaveUp: (cb: (payload: { attempts: number }) => void) => () => void
    onDied: (cb: (info: { code: number | null; ts: number }) => void) => () => void
  }
  diagnostic: {
    collect: () => Promise<{ timestamp: number; text: string }>
    copy: (text: string) => Promise<{ success: boolean; error?: string }>
  }
  troubleshoot: {
    checkPort: () => Promise<{ inUse: boolean; pid?: string }>
    doctorFix: () => Promise<{ success: boolean }>
  }
  wsl: {
    check: () => Promise<WslState>
    install: (
      prevState?: WslState
    ) => Promise<{ success: boolean; needsReboot?: boolean; state?: WslState; error?: string }>
  }
  wizard: {
    saveState: (state: WizardPersistedState) => Promise<{ success: boolean }>
    loadState: () => Promise<WizardPersistedState | null>
    clearState: () => Promise<{ success: boolean }>
  }
  newsletter: {
    subscribe: (email: string) => Promise<{ success: boolean }>
  }
  update: {
    check: () => Promise<{ success: boolean }>
    download: () => Promise<{ success: boolean }>
    install: () => Promise<{ success: boolean }>
    onAvailable: (cb: (info: { version: string }) => void) => () => void
    onProgress: (cb: (percent: number) => void) => () => void
    onDownloaded: (cb: () => void) => () => void
    onError: (cb: (msg: string) => void) => () => void
  }
  config: {
    read: () => Promise<{
      success: boolean
      config: { provider?: string; model?: string; hasTelegram?: boolean } | null
      error?: string
    }>
    switchProvider: (config: {
      provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
      apiKey?: string
      authMethod?: 'api-key' | 'oauth'
      modelId?: string
    }) => Promise<{ success: boolean; error?: string }>
  }
  openclaw: {
    checkUpdate: () => Promise<{ currentVersion: string | null; latestVersion: string | null }>
  }
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>
    set: (enabled: boolean) => Promise<{ success: boolean }>
  }
  uninstall: {
    openclaw: (opts: { removeConfig: boolean }) => Promise<{ success: boolean; error?: string }>
    onProgress: (cb: (msg: string) => void) => () => void
  }
  backup: {
    export: () => Promise<{ success: boolean; error?: string }>
    import: () => Promise<{ success: boolean; error?: string }>
  }
  i18n: {
    getLocale: () => Promise<string>
    setLanguage: (lng: string) => Promise<{ success: boolean; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
