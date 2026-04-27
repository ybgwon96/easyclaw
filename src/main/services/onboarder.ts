import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { platform, homedir } from 'os'
import { join } from 'path'
import https from 'https'
import { app, BrowserWindow } from 'electron'
import { runInWsl, readWslFile, writeWslFile, WSL_NVM_INIT } from './wsl-utils'
import { t } from '../../shared/i18n/main'

const launchdLogPaths = (): { logsDir: string; stdoutPath: string; stderrPath: string } => {
  const logsDir = join(app.getPath('userData'), 'logs')
  return {
    logsDir,
    stdoutPath: join(logsDir, 'launchd-gateway.out.log'),
    stderrPath: join(logsDir, 'launchd-gateway.err.log')
  }
}

const ensureDir = (dir: string): void => {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    /* best effort — launchd will surface errors if path is unwritable */
  }
}

interface OnboardConfig {
  provider: 'anthropic' | 'google' | 'openai' | 'minimax' | 'glm' | 'deepseek' | 'ollama'
  apiKey?: string
  authMethod?: 'api-key' | 'oauth'
  telegramBotToken?: string
  modelId?: string
}

interface OnboardResult {
  botUsername?: string
}

const telegramGet = (url: string): Promise<{ ok: boolean; [k: string]: unknown }> =>
  new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve({ ok: false })
          }
        })
      })
      .on('error', () => resolve({ ok: false }))
  })

const fetchBotUsername = async (token: string): Promise<string | undefined> => {
  const json = await telegramGet(`https://api.telegram.org/bot${token}/getMe`)
  return json.ok ? (json as unknown as { result: { username: string } }).result.username : undefined
}

const waitTelegramClear = async (token: string): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    const res = await telegramGet(
      `https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=1`
    )
    if (res.ok) return
    await new Promise((r) => setTimeout(r, 3000))
  }
}

import { getPathEnv, findBin } from './path-utils'

const OAUTH_PROFILE_ID = 'openai-codex:default'

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'anthropic/claude-sonnet-4-6',
  google: 'google/gemini-3-flash',
  openai: 'openai/gpt-5.4',
  'openai-codex': 'openai-codex/gpt-5.4',
  minimax: 'minimax/MiniMax-M2.7',
  glm: 'zai/glm-5',
  deepseek: 'deepseek/deepseek-chat',
  ollama: 'ollama/llama3.3'
}

const MODEL_SPECS: Partial<
  Record<OnboardConfig['provider'], { contextWindow: number; maxTokens: number }>
> = {
  minimax: { contextWindow: 1000000, maxTokens: 16384 }
}

const createRunCmd = (): ((
  cmd: string,
  args: string[],
  onLog: (msg: string) => void
) => Promise<void>) => {
  const isWindows = platform() === 'win32'

  return (cmd, args, onLog) =>
    new Promise((resolve, reject) => {
      let fullCmd: string
      let fullArgs: string[]

      if (isWindows) {
        // WSL mode: wsl -d Ubuntu -u root -- bash -lc "cmd args..."
        // Call openclaw directly instead of `npm exec -- openclaw` — npm 10+
        // cannot resolve globally installed packages in a non-interactive
        // bash -lc shell, which previously caused "command not found".
        const script = `${WSL_NVM_INIT}${cmd} ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
        fullCmd = 'wsl'
        fullArgs = ['-d', 'Ubuntu', '-u', 'root', '--', 'bash', '-lc', script]
      } else {
        fullCmd = cmd
        fullArgs = args
      }

      const child = spawn(fullCmd, fullArgs, {
        env: isWindows ? process.env : getPathEnv()
      })

      const outDecoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      child.stdout.on('data', (d) => outDecoder.write(d).split('\n').filter(Boolean).forEach(onLog))
      child.stderr.on('data', (d) => errDecoder.write(d).split('\n').filter(Boolean).forEach(onLog))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Command failed with exit code ${code}`))
      })
      child.on('error', reject)
    })
}

export const wslKillOpenclaw = (): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn('wsl', [
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'pkill',
      '-9',
      '-f',
      'openclaw'
    ])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })

// Patch launchd plist to capture daemon stdout/stderr to disk so EasyClaw
// can show recent crash output to the user. Idempotent — bails when keys
// are already present. Run once at app startup for upgraders.
export const migrateGatewayPlist = async (): Promise<void> => {
  if (platform() !== 'darwin') return
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
  if (!existsSync(plistPath)) return
  let xml: string
  try {
    xml = readFileSync(plistPath, 'utf-8')
  } catch {
    return
  }
  if (xml.includes('StandardOutPath')) return

  const { logsDir, stdoutPath, stderrPath } = launchdLogPaths()
  ensureDir(logsDir)

  const insertion =
    `<key>StandardOutPath</key>\n  <string>${stdoutPath}</string>\n` +
    `  <key>StandardErrorPath</key>\n  <string>${stderrPath}</string>\n  `
  const patched = xml.replace(/<\/dict>\s*<\/plist>/, `${insertion}</dict>\n</plist>`)
  if (patched === xml) return

  try {
    writeFileSync(plistPath, patched)
  } catch {
    return
  }

  const uid = process.getuid?.() ?? ''
  await new Promise<void>((resolve) => {
    const child = spawn('launchctl', ['bootout', `gui/${uid}/ai.openclaw.gateway`])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
  await new Promise((r) => setTimeout(r, 500))
  await new Promise<void>((resolve) => {
    const child = spawn('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

export const runOnboard = async (
  win: BrowserWindow,
  config: OnboardConfig
): Promise<OnboardResult> => {
  const log = (msg: string): void => {
    win.webContents.send('install:progress', msg)
  }

  log(t('onboarder.starting'))

  const isWindows = platform() === 'win32'
  const isMac = platform() === 'darwin'
  const ocBin = isWindows ? 'openclaw' : findBin('openclaw')
  const fixPath = join(homedir(), '.openclaw', 'ipv4-fix.js')
  const runCmd = createRunCmd()

  // Prevent Telegram API ETIMEDOUT on environments without IPv6 (Node.js 22 autoSelectFamily)
  if (isMac) {
    const macOcDir = join(homedir(), '.openclaw')
    if (!existsSync(macOcDir)) mkdirSync(macOcDir, { recursive: true })
    const fixContent = [
      "const dns = require('dns')",
      'const origLookup = dns.lookup',
      'dns.lookup = function (hostname, options, callback) {',
      "  if (typeof options === 'function') { callback = options; options = { family: 4 } }",
      "  else if (typeof options === 'number') { options = { family: 4 } }",
      '  else { options = Object.assign({}, options, { family: 4 }) }',
      '  return origLookup.call(this, hostname, options, callback)',
      '}'
    ].join('\n')
    writeFileSync(fixPath, fixContent + '\n')

    await new Promise<void>((resolve) => {
      const child = spawn('launchctl', ['setenv', 'NODE_OPTIONS', `--require=${fixPath}`])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
  }

  // Remove existing daemon + kill processes + clean up broken config
  if (isWindows) {
    await wslKillOpenclaw().catch(() => {})
    // Clean up config files inside WSL (preserve auth-profiles.json for OAuth)
    try {
      await runInWsl('rm -f /root/.openclaw/openclaw.json')
    } catch {
      /* ignore */
    }
    const wslAuthClean =
      config.authMethod === 'oauth'
        ? 'rm -f /root/.openclaw/agents/main/agent/auth.json'
        : 'rm -f /root/.openclaw/agents/main/agent/auth.json /root/.openclaw/agents/main/agent/auth-profiles.json'
    try {
      await runInWsl(wslAuthClean)
    } catch {
      /* ignore */
    }
  } else {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    if (existsSync(plist)) {
      await new Promise<void>((resolve) => {
        const child = spawn('launchctl', ['unload', plist])
        child.on('close', () => resolve())
        child.on('error', () => resolve())
      })
      try {
        unlinkSync(plist)
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    const macOcDir = join(homedir(), '.openclaw')
    const configFile = join(macOcDir, 'openclaw.json')
    if (existsSync(configFile))
      try {
        unlinkSync(configFile)
      } catch {
        /* ignore */
      }
    const agentAuthDir = join(macOcDir, 'agents', 'main', 'agent')
    // OAuth: preserve auth-profiles.json since credentials were already saved
    const authFilesToClean =
      config.authMethod === 'oauth' ? ['auth.json'] : ['auth.json', 'auth-profiles.json']
    for (const f of authFilesToClean) {
      const p = join(agentAuthDir, f)
      if (existsSync(p))
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
    }
  }
  // Wait for port release + Telegram long-poll release
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // OAuth: credentials already saved to auth-profiles.json, skip auth in onboard
  const effectiveProvider = config.authMethod === 'oauth' ? 'openai-codex' : config.provider
  const effectiveAuthFlags =
    config.authMethod === 'oauth'
      ? ['--auth-choice', 'skip']
      : config.provider === 'ollama'
        ? ['--auth-choice', 'ollama']
        : config.provider === 'deepseek'
          ? ['--auth-choice', 'skip']
          : {
              anthropic: ['--auth-choice', 'apiKey', '--anthropic-api-key', config.apiKey!],
              google: ['--auth-choice', 'gemini-api-key', '--gemini-api-key', config.apiKey!],
              openai: ['--auth-choice', 'openai-api-key', '--openai-api-key', config.apiKey!],
              minimax: ['--auth-choice', 'minimax-api', '--minimax-api-key', config.apiKey!],
              glm: ['--auth-choice', 'zai-api-key', '--zai-api-key', config.apiKey!]
            }[config.provider]

  const openclawArgs = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--mode',
    'local',
    ...effectiveAuthFlags,
    '--gateway-port',
    '18789',
    '--gateway-bind',
    'loopback',
    // Windows WSL: no daemon install needed since DoneStep starts as foreground process
    ...(isWindows ? [] : ['--install-daemon', '--daemon-runtime', 'node']),
    '--skip-skills'
  ]

  try {
    await runCmd(ocBin, openclawArgs, log)
  } catch (e) {
    // Even if onboard fails with gateway connection test (1006),
    // continue if config file was created
    if (isWindows) {
      try {
        await readWslFile('/root/.openclaw/openclaw.json')
      } catch {
        throw e
      }
      log(t('onboarder.configCreatedSkipGw'))
    } else {
      const configPath = join(homedir(), '.openclaw', 'openclaw.json')
      if (!existsSync(configPath)) throw e
      log(t('onboarder.configCreatedSkipGw'))
    }
  }

  // Stop immediately since onboard --install-daemon starts the daemon
  if (isMac) {
    const uid = process.getuid?.() ?? ''
    await new Promise<void>((resolve) => {
      const child = spawn('launchctl', ['bootout', `gui/${uid}/ai.openclaw.gateway`])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw-gateway'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  // Set recommended model per provider
  const patchConfig = (ocConfig: Record<string, unknown>): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = ocConfig as any
    cfg.agents = cfg.agents ?? {}
    cfg.agents.defaults = cfg.agents.defaults ?? {}
    cfg.agents.defaults.model = {
      ...cfg.agents.defaults.model,
      primary: config.modelId || DEFAULT_MODELS[effectiveProvider]
    }
    // OAuth: register auth profile reference in config
    if (config.authMethod === 'oauth') {
      cfg.auth = cfg.auth ?? {}
      cfg.auth.profiles = {
        ...cfg.auth.profiles,
        [OAUTH_PROFILE_ID]: { provider: 'openai-codex', mode: 'oauth' }
      }
      cfg.auth.order = { ...cfg.auth.order, 'openai-codex': [OAUTH_PROFILE_ID] }
    }
    // DeepSeek: register custom provider (not built-in)
    if (config.provider === 'deepseek' && config.apiKey) {
      cfg.models = cfg.models ?? {}
      cfg.models.providers = cfg.models.providers ?? {}
      cfg.models.providers.deepseek = {
        baseUrl: 'https://api.deepseek.com/v1',
        api: 'openai-completions',
        apiKey: config.apiKey,
        models: [
          { id: 'deepseek-chat', contextWindow: 128000, maxTokens: 8192 },
          { id: 'deepseek-reasoner', contextWindow: 128000, maxTokens: 64000 }
        ]
      }
    }
    const spec = MODEL_SPECS[config.provider]
    if (spec && cfg.models?.providers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const provider of Object.values(cfg.models.providers) as any[]) {
        if (Array.isArray(provider.models)) {
          for (const m of provider.models) {
            m.contextWindow = spec.contextWindow
            m.maxTokens = spec.maxTokens
          }
        }
      }
    }
  }

  // Patch config file
  if (isWindows) {
    try {
      const raw = await readWslFile('/root/.openclaw/openclaw.json')
      const ocConfig = JSON.parse(raw)
      patchConfig(ocConfig)
      await writeWslFile('/root/.openclaw/openclaw.json', JSON.stringify(ocConfig, null, 2))
    } catch {
      /* config not found — skip patch */
    }
  } else {
    const modelConfigPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(modelConfigPath)) {
      const ocConfig = JSON.parse(readFileSync(modelConfigPath, 'utf-8'))
      patchConfig(ocConfig)
      writeFileSync(modelConfigPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
    }
  }
  log(t('onboarder.basicDone'))

  // Apply IPv4 fix to plist (macOS only)
  if (isMac) {
    const plistAfter = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    if (existsSync(plistAfter)) {
      let xml = readFileSync(plistAfter, 'utf-8')
      if (!xml.includes('ipv4-fix')) {
        xml = xml.replace(
          '<string>/usr/local/bin/node</string>',
          `<string>/usr/local/bin/node</string>\n      <string>--require=${fixPath}</string>`
        )
      }
      const nodeOpt = `--require=${fixPath}`
      if (!xml.includes('NODE_OPTIONS')) {
        xml = xml.replace(
          '</dict>\n  </dict>',
          `<key>NODE_OPTIONS</key>\n    <string>${nodeOpt}</string>\n    </dict>\n  </dict>`
        )
      }
      if (!xml.includes('StandardOutPath')) {
        const { logsDir, stdoutPath, stderrPath } = launchdLogPaths()
        ensureDir(logsDir)
        const insertion =
          `<key>StandardOutPath</key>\n  <string>${stdoutPath}</string>\n` +
          `  <key>StandardErrorPath</key>\n  <string>${stderrPath}</string>\n  `
        xml = xml.replace(/<\/dict>\s*<\/plist>/, `${insertion}</dict>\n</plist>`)
      }
      writeFileSync(plistAfter, xml)
    }
  }

  let botUsername: string | undefined

  if (config.telegramBotToken) {
    log(t('onboarder.addingTelegram'))
    const telegramChannel = {
      enabled: true,
      botToken: config.telegramBotToken,
      dmPolicy: 'open',
      allowFrom: ['*'],
      groups: { '*': { requireMention: true } }
    }

    if (isWindows) {
      try {
        const raw = await readWslFile('/root/.openclaw/openclaw.json')
        const ocConfig = JSON.parse(raw)
        ocConfig.channels = { ...ocConfig.channels, telegram: telegramChannel }
        await writeWslFile('/root/.openclaw/openclaw.json', JSON.stringify(ocConfig, null, 2))
        log(t('onboarder.telegramDone'))
      } catch {
        log(t('onboarder.configNotFound'))
      }
    } else {
      const configPath = join(homedir(), '.openclaw', 'openclaw.json')
      if (existsSync(configPath)) {
        const ocConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
        ocConfig.channels = { ...ocConfig.channels, telegram: telegramChannel }
        writeFileSync(configPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
        log(t('onboarder.telegramDone'))
      } else {
        log(t('onboarder.configNotFound'))
      }
    }

    botUsername = await fetchBotUsername(config.telegramBotToken)
  }

  if (config.telegramBotToken) {
    log(t('onboarder.checkingTelegram'))
    await waitTelegramClear(config.telegramBotToken)
  }

  // Restart daemon after all patches are complete
  if (isWindows) {
    log(t('onboarder.cleaningGateway'))
    await wslKillOpenclaw().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } else if (isMac) {
    log(t('onboarder.startingGateway'))
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist')
    const uid = process.getuid?.() ?? ''
    if (existsSync(plistPath)) {
      await new Promise<void>((resolve) => {
        const child = spawn('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
        child.on('close', () => resolve())
        child.on('error', () => resolve())
      })
    }
  }

  return { botUsername }
}

// ─── Provider switch ───

export interface CurrentConfig {
  provider?: string
  model?: string
  hasTelegram?: boolean
}

export const readCurrentConfig = async (): Promise<CurrentConfig | null> => {
  const isWindows = platform() === 'win32'
  try {
    let raw: string
    if (isWindows) {
      raw = await readWslFile('/root/.openclaw/openclaw.json')
    } else {
      const configPath = join(homedir(), '.openclaw', 'openclaw.json')
      if (!existsSync(configPath)) return null
      raw = readFileSync(configPath, 'utf-8')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = JSON.parse(raw) as any
    const model = cfg?.agents?.defaults?.model?.primary as string | undefined
    const hasTelegram = !!cfg?.channels?.telegram?.botToken
    // Extract provider from model ID (e.g. "anthropic/claude-sonnet-4-6" → "anthropic")
    const provider = model?.split('/')[0]
    return { provider, model, hasTelegram }
  } catch {
    return null
  }
}

export const switchProvider = async (
  win: BrowserWindow,
  config: {
    provider: OnboardConfig['provider']
    apiKey?: string
    authMethod?: 'api-key' | 'oauth'
    modelId?: string
  }
): Promise<void> => {
  const log = (msg: string): void => {
    win.webContents.send('install:progress', msg)
  }

  const isWindows = platform() === 'win32'
  const isMac = platform() === 'darwin'
  const ocBin = isWindows ? 'openclaw' : findBin('openclaw')
  const runCmd = createRunCmd()

  log(t('onboarder.switchStarting'))

  // 1. Preserve existing Telegram token
  let savedTelegram: Record<string, unknown> | null = null
  try {
    let raw: string
    if (isWindows) {
      raw = await readWslFile('/root/.openclaw/openclaw.json')
    } else {
      raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf-8')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = JSON.parse(raw) as any
    if (cfg?.channels?.telegram?.botToken) {
      savedTelegram = cfg.channels.telegram
    }
  } catch {
    /* no config yet */
  }

  // 2. Prevent Telegram 409 conflict
  if (savedTelegram && (savedTelegram as { botToken?: string }).botToken) {
    log(t('onboarder.cleaningTelegram'))
    await waitTelegramClear((savedTelegram as { botToken: string }).botToken)
  }

  // 3. Clean up existing processes
  log(t('onboarder.cleaningGateway'))
  if (isWindows) {
    await wslKillOpenclaw().catch(() => {})
  } else {
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // 4. Delete existing config/auth files (preserve auth-profiles.json for OAuth)
  const preserveAuthProfiles = config.authMethod === 'oauth'
  if (isWindows) {
    try {
      await runInWsl('rm -f /root/.openclaw/openclaw.json')
    } catch {
      /* ignore */
    }
    const wslAuthClean = preserveAuthProfiles
      ? 'rm -f /root/.openclaw/agents/main/agent/auth.json'
      : 'rm -f /root/.openclaw/agents/main/agent/auth.json /root/.openclaw/agents/main/agent/auth-profiles.json'
    try {
      await runInWsl(wslAuthClean)
    } catch {
      /* ignore */
    }
  } else {
    const ocDir = join(homedir(), '.openclaw')
    const filesToClean = [
      'openclaw.json',
      join('agents', 'main', 'agent', 'auth.json'),
      ...(preserveAuthProfiles ? [] : [join('agents', 'main', 'agent', 'auth-profiles.json')])
    ]
    for (const f of filesToClean) {
      const p = join(ocDir, f)
      if (existsSync(p))
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
    }
  }

  // 5. Re-run openclaw onboard
  log(t('onboarder.settingNewProvider'))
  // OAuth: credentials already saved to auth-profiles.json, skip auth in onboard
  const effectiveProvider = config.authMethod === 'oauth' ? 'openai-codex' : config.provider
  const effectiveAuthFlags =
    config.authMethod === 'oauth'
      ? ['--auth-choice', 'skip']
      : config.provider === 'ollama'
        ? ['--auth-choice', 'ollama']
        : config.provider === 'deepseek'
          ? ['--auth-choice', 'skip']
          : {
              anthropic: ['--auth-choice', 'apiKey', '--anthropic-api-key', config.apiKey!],
              google: ['--auth-choice', 'gemini-api-key', '--gemini-api-key', config.apiKey!],
              openai: ['--auth-choice', 'openai-api-key', '--openai-api-key', config.apiKey!],
              minimax: ['--auth-choice', 'minimax-api', '--minimax-api-key', config.apiKey!],
              glm: ['--auth-choice', 'zai-api-key', '--zai-api-key', config.apiKey!]
            }[config.provider]

  const openclawArgs = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--mode',
    'local',
    ...effectiveAuthFlags,
    '--gateway-port',
    '18789',
    '--gateway-bind',
    'loopback',
    ...(isWindows ? [] : ['--install-daemon', '--daemon-runtime', 'node']),
    '--skip-skills'
  ]

  try {
    await runCmd(ocBin, openclawArgs, log)
  } catch (e) {
    if (isWindows) {
      try {
        await readWslFile('/root/.openclaw/openclaw.json')
      } catch {
        throw e
      }
    } else {
      if (!existsSync(join(homedir(), '.openclaw', 'openclaw.json'))) throw e
    }
    log(t('onboarder.configCreatedSkipGw'))
  }

  // 6. Stop daemon immediately (macOS)
  if (isMac) {
    const uid = process.getuid?.() ?? ''
    await new Promise<void>((resolve) => {
      const child = spawn('launchctl', ['bootout', `gui/${uid}/ai.openclaw.gateway`])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise<void>((resolve) => {
      const child = spawn('pkill', ['-9', '-f', 'openclaw-gateway'])
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    })
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  // 7. Patch model
  log(t('onboarder.applyingModel'))

  const patchSwitchConfig = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ocConfig: any,
    telegram: Record<string, unknown> | null
  ): void => {
    ocConfig.agents = ocConfig.agents ?? {}
    ocConfig.agents.defaults = ocConfig.agents.defaults ?? {}
    ocConfig.agents.defaults.model = {
      ...ocConfig.agents.defaults.model,
      primary: config.modelId || DEFAULT_MODELS[effectiveProvider]
    }
    // OAuth: register auth profile reference in config
    if (config.authMethod === 'oauth') {
      ocConfig.auth = ocConfig.auth ?? {}
      ocConfig.auth.profiles = {
        ...ocConfig.auth.profiles,
        [OAUTH_PROFILE_ID]: { provider: 'openai-codex', mode: 'oauth' }
      }
      ocConfig.auth.order = { ...ocConfig.auth.order, 'openai-codex': [OAUTH_PROFILE_ID] }
    }
    // DeepSeek: register custom provider (not built-in)
    if (config.provider === 'deepseek' && config.apiKey) {
      ocConfig.models = ocConfig.models ?? {}
      ocConfig.models.providers = ocConfig.models.providers ?? {}
      ocConfig.models.providers.deepseek = {
        baseUrl: 'https://api.deepseek.com/v1',
        api: 'openai-completions',
        apiKey: config.apiKey,
        models: [
          { id: 'deepseek-chat', contextWindow: 128000, maxTokens: 8192 },
          { id: 'deepseek-reasoner', contextWindow: 128000, maxTokens: 64000 }
        ]
      }
    }
    const spec = MODEL_SPECS[effectiveProvider as OnboardConfig['provider']]
    if (spec && ocConfig.models?.providers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const provider of Object.values(ocConfig.models.providers) as any[]) {
        if (Array.isArray(provider.models)) {
          for (const m of provider.models) {
            m.contextWindow = spec.contextWindow
            m.maxTokens = spec.maxTokens
          }
        }
      }
    }
    // Restore Telegram token
    if (telegram) {
      ocConfig.channels = { ...ocConfig.channels, telegram }
    }
  }

  if (isWindows) {
    try {
      const raw = await readWslFile('/root/.openclaw/openclaw.json')
      const ocConfig = JSON.parse(raw)
      patchSwitchConfig(ocConfig, savedTelegram)
      await writeWslFile('/root/.openclaw/openclaw.json', JSON.stringify(ocConfig, null, 2))
    } catch {
      /* config not found */
    }
  } else {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(configPath)) {
      const ocConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
      patchSwitchConfig(ocConfig, savedTelegram)
      writeFileSync(configPath, JSON.stringify(ocConfig, null, 2), { mode: 0o600 })
    }
  }

  log(t('onboarder.switchDone'))
}
