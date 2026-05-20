import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import https from 'https'
import { BrowserWindow } from 'electron'
import {
  checkWslState,
  runInWsl,
  runInWslStreaming,
  WSL_STATE_ORDER,
  type WslState
} from './wsl-utils'
import { getPathEnv } from './path-utils'
import { t } from '../../shared/i18n/main'

type ProgressCallback = (msg: string) => void

interface RunError extends Error {
  lines?: string[]
}

const sendProgress = (win: BrowserWindow, msg: string): void => {
  win.webContents.send('install:progress', msg)
}

const downloadFile = (url: string, dest: string, maxRedirects = 5): Promise<void> =>
  new Promise((resolve, reject) => {
    let redirectCount = 0
    const follow = (u: string): void => {
      https
        .get(u, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume()
            if (++redirectCount > maxRedirects) {
              reject(new Error('Too many redirects'))
              return
            }
            follow(res.headers.location)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            res.resume()
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const file = createWriteStream(dest)
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', reject)
        })
        .on('error', reject)
    }
    follow(url)
  })

const runWithLog = (
  cmd: string,
  args: string[],
  onLog: ProgressCallback,
  options?: { shell?: boolean; env?: NodeJS.ProcessEnv; cwd?: string }
): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: options?.shell ?? false,
      env: options?.env ?? process.env,
      cwd: options?.cwd
    })

    const lines: string[] = []
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    child.stdout.on('data', (d) => {
      outDecoder
        .write(d)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => {
          onLog(l)
          lines.push(l)
        })
    })
    child.stderr.on('data', (d) => {
      errDecoder
        .write(d)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => {
          onLog(l)
          lines.push(l)
        })
    })
    child.on('close', (code) => {
      if (code === 0) resolve(lines)
      else {
        const err: RunError = new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${code})`)
        err.lines = lines
        reject(err)
      }
    })
    child.on('error', reject)
  })

// ─── WSL installation functions (Windows) ───

/** Install WSL itself (wsl --install -d Ubuntu --no-launch) — UAC elevation */
export const installWsl = async (
  win: BrowserWindow,
  prevState?: WslState
): Promise<{ needsReboot: boolean; state: WslState }> => {
  const log = (msg: string): void => sendProgress(win, msg)
  const baseline = prevState ?? (await checkWslState())

  log(t('installer.wslInstalling'))
  log(t('installer.wslAdminPrompt'))

  try {
    const psCommand = [
      'try {',
      "  $p = Start-Process -FilePath 'wsl' -ArgumentList '--install -d Ubuntu --no-launch' -Verb RunAs -Wait -PassThru;",
      '  exit $p.ExitCode',
      '} catch {',
      '  Write-Output $_.Exception.Message;',
      '  exit 1',
      '}'
    ].join(' ')
    await runWithLog('powershell', ['-NoProfile', '-Command', psCommand], log)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : ''
    const errLines = ((err as RunError).lines ?? []).join('\n')
    const lower = (errMsg + '\n' + errLines).toLowerCase()

    // Definite failures — throw immediately
    if (
      lower.includes('canceled') ||
      lower.includes('cancelled') ||
      lower.includes('elevation') ||
      lower.includes('access denied') ||
      lower.includes('permission')
    ) {
      throw new Error(t('installer.adminRequired'))
    }
    if (lower.includes('not recognized') || lower.includes('not found')) {
      throw new Error(t('installer.windowsVersionError'))
    }
    if (lower.includes('virtualization') || lower.includes('hyper-v')) {
      throw new Error(t('installer.biosVirtualization'))
    }
    // exit -1 (4294967295) is WSL's signal that a reboot is required
    if (errMsg.includes('exit -1') || errMsg.includes('exit 4294967295')) {
      log(t('installer.wslDone'))
      return { needsReboot: true, state: 'needs_reboot' }
    }
    // Other ambiguous errors — fall through to state check
  }

  // Verify actual WSL state regardless of exit code
  log(t('installer.wslCheckingState'))
  const newState = await checkWslState()

  if (newState === 'ready') {
    log(t('installer.wslDone'))
    return { needsReboot: false, state: newState }
  }

  const improved = WSL_STATE_ORDER.indexOf(newState) > WSL_STATE_ORDER.indexOf(baseline)

  if (newState === 'needs_reboot' || improved) {
    log(t('installer.wslDone'))
    return { needsReboot: newState === 'needs_reboot', state: newState }
  }

  // No state change — actual failure; show user-friendly message
  throw new Error(t('installer.wslInstallFailed'))
}

/** Install Node.js 22 LTS inside WSL Ubuntu (NodeSource apt repo) */
export const installNodeWsl = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)

  log(t('installer.wslPackages'))
  try {
    await runInWsl('apt-get update && apt-get install -y curl ca-certificates gnupg', 60000)
  } catch {
    log(t('installer.aptFailed'))
  }

  log(t('installer.nodeWslInstalling'))
  await runInWsl(
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs',
    120000
  )

  log(t('installer.nodeWslDone'))
}

/**
 * Reusable WSL install core — streams logs to onLine. Used by both the
 * interactive installer flow and the background auto-update path.
 */
export const installOpenClawWslCore = async (
  onLine: (msg: string) => void,
  timeoutMs = 300_000
): Promise<void> => {
  await runInWslStreaming('npm install -g openclaw@latest', onLine, timeoutMs)
}

/** Install openclaw globally inside WSL Ubuntu */
export const installOpenClawWsl = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log(t('installer.ocWslInstalling'))
  await installOpenClawWslCore(log)
  log(t('installer.ocWslDone'))
}

// ─── macOS installation functions ───

export const installNodeMac = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  const url = `https://nodejs.org/dist/v22.14.0/node-v22.14.0.pkg`
  const dest = join(tmpdir(), 'node-installer.pkg')

  log(t('installer.nodeDownloading'))
  await downloadFile(url, dest)
  log(t('installer.nodeInstallerOpening'))
  await runWithLog('open', ['-W', dest], log)
  log(t('installer.nodeDone'))
}

// getPathEnv imported from path-utils.ts (includes NODE_OPTIONS removal)

const isXcodeCliInstalled = (): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn('xcode-select', ['-p'])
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })

const ensureXcodeCli = async (log: ProgressCallback): Promise<void> => {
  if (await isXcodeCliInstalled()) return

  log(t('installer.xcodeOpening'))
  spawn('xcode-select', ['--install'])

  log(t('installer.xcodePrompt'))
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    if (await isXcodeCliInstalled()) {
      log(t('installer.xcodeDone'))
      return
    }
  }
  throw new Error(t('installer.xcodeTimeout'))
}

/**
 * Reusable macOS install core — handles npm cache permission fix and prefix
 * config before running npm install. Streams logs to onLine. Used by both
 * the interactive installer flow and the background auto-update path.
 *
 * Does NOT run ensureXcodeCli — that requires user interaction and should
 * only happen in the interactive flow.
 */
export const installOpenClawMacCore = async (onLine: (msg: string) => void): Promise<void> => {
  const npmCacheDir = join(homedir(), '.npm')
  if (existsSync(npmCacheDir)) {
    const uid = process.getuid?.() ?? 501
    const gid = process.getgid?.() ?? 20
    await runWithLog('chown', ['-R', `${uid}:${gid}`, npmCacheDir], onLine).catch(() => {})
  }
  const npmGlobalDir = join(homedir(), '.npm-global')
  if (!existsSync(npmGlobalDir)) mkdirSync(npmGlobalDir, { recursive: true })
  await runWithLog('npm', ['config', 'set', 'prefix', npmGlobalDir], onLine, {
    env: getPathEnv()
  })
  await runWithLog('npm', ['install', '-g', 'openclaw@latest'], onLine, {
    env: getPathEnv()
  })
}

export const installOpenClaw = async (win: BrowserWindow): Promise<void> => {
  const log = (msg: string): void => sendProgress(win, msg)
  log(t('installer.ocInstalling'))

  await ensureXcodeCli(log)
  await installOpenClawMacCore(log)

  log(t('installer.ocDone'))
}
