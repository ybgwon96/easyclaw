import { app } from 'electron'
import { spawn } from 'child_process'
import { platform, arch, release } from 'os'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getRecentLines } from './gateway-log-rotator'
import { getRecentEntries } from './gateway-restart-history'
import { getSupervisor } from './gateway-supervisor'
import { GATEWAY_PORT, LAUNCHD_LABEL } from './gateway-probes'
import { checkPort } from './troubleshooter'
import { getPathEnv } from './path-utils'

export interface DiagnosticReport {
  timestamp: number
  text: string
}

const SUB_PROBE_TIMEOUT_MS = 3000
const TOTAL_BUDGET_MS = 10_000

const PII_PATTERNS: Array<[RegExp, string]> = [
  // Telegram bot tokens: bot1234567890:AAH...
  [/(bot\d+:)[A-Za-z0-9_-]{30,}/g, '$1****MASKED****'],
  // OpenAI / Anthropic / Generic sk- API keys
  [/sk-[A-Za-z0-9_-]{20,}/g, 'sk-****MASKED****'],
  // Google API keys
  [/AIza[A-Za-z0-9_-]{30,}/g, 'AIza****MASKED****'],
  // Anthropic-style sk-ant-api03-...
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'sk-ant-****MASKED****']
]

const maskPii = (text: string): string => {
  let masked = text
  for (const [pattern, replacement] of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement)
  }
  return masked
}

const runShort = (
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: env ?? process.env })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, SUB_PROBE_TIMEOUT_MS)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: null })
    })
  })

const withTimeout = async <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const collectMacBlock = async (): Promise<string> => {
  const uid = process.getuid?.() ?? 0
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
  const plistExists = existsSync(plistPath)
  let plistContents = '<not found>'
  if (plistExists) {
    try {
      plistContents = readFileSync(plistPath, 'utf-8').trim()
    } catch (err) {
      plistContents = `<failed: ${(err as Error).message}>`
    }
  }
  const launchdState = await withTimeout(
    runShort('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`], getPathEnv()),
    SUB_PROBE_TIMEOUT_MS,
    { stdout: '<failed: timeout>', stderr: '', code: null }
  )
  return [
    `[macOS]`,
    `launchd label: ${LAUNCHD_LABEL}`,
    `plist path: ${plistPath} (${plistExists ? 'exists' : 'missing'})`,
    `launchctl print:`,
    launchdState.stdout.trim() || '<empty>',
    `--- plist contents ---`,
    plistContents
  ].join('\n')
}

const collectWslBlock = async (): Promise<string> => {
  const versionResult = await withTimeout(runShort('wsl', ['--version']), SUB_PROBE_TIMEOUT_MS, {
    stdout: '<failed: timeout>',
    stderr: '',
    code: null
  })
  const listResult = await withTimeout(
    runShort('wsl', ['--list', '--verbose']),
    SUB_PROBE_TIMEOUT_MS,
    { stdout: '<failed: timeout>', stderr: '', code: null }
  )
  const ssResult = await withTimeout(
    runShort('wsl', [
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'bash',
      '-lc',
      `ss -ltn 2>/dev/null | grep ':${GATEWAY_PORT}' || echo '<no listener>'`
    ]),
    SUB_PROBE_TIMEOUT_MS,
    { stdout: '<failed: timeout>', stderr: '', code: null }
  )
  const binResult = await withTimeout(
    runShort('wsl', [
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'bash',
      '-lc',
      'command -v openclaw 2>/dev/null || echo "<not on PATH>"'
    ]),
    SUB_PROBE_TIMEOUT_MS,
    { stdout: '<failed: timeout>', stderr: '', code: null }
  )
  return [
    `[Windows WSL]`,
    `wsl --version:`,
    versionResult.stdout.trim() || versionResult.stderr.trim() || '<empty>',
    `wsl --list --verbose:`,
    listResult.stdout.trim() || '<empty>',
    `WSL openclaw bin: ${binResult.stdout.trim() || '<unknown>'}`,
    `WSL ss output for port ${GATEWAY_PORT}:`,
    ssResult.stdout.trim() || '<empty>'
  ].join('\n')
}

const formatHistory = (): string => {
  const entries = getRecentEntries(60 * 60 * 1000)
  if (entries.length === 0) return '<no restart events in last hour>'
  return entries
    .map((e) => {
      const stamp = new Date(e.ts).toISOString()
      const exit = e.exitCode === undefined ? '' : ` exit=${e.exitCode}`
      return `${stamp} kind=${e.kind} success=${e.success}${exit}`
    })
    .join('\n')
}

export const collect = async (): Promise<DiagnosticReport> => {
  const start = Date.now()
  const supervisor = getSupervisor()
  const lastExit = supervisor.lastExitInfo()
  const portInfo = await withTimeout(checkPort(), SUB_PROBE_TIMEOUT_MS, { inUse: false })

  const portLine = portInfo.inUse
    ? `Port ${GATEWAY_PORT}: in use by PID ${portInfo.pid ?? '?'}`
    : `Port ${GATEWAY_PORT}: free`

  const stderrTail = lastExit?.stderrTail?.trim() || '<no recent crash output>'
  const stdoutLines = getRecentLines(50, 'stdout').join('\n')

  const platformBlock = await withTimeout(
    platform() === 'win32' ? collectWslBlock() : collectMacBlock(),
    Math.min(TOTAL_BUDGET_MS - (Date.now() - start), SUB_PROBE_TIMEOUT_MS * 3),
    '<platform diagnostics timed out>'
  )

  const lines: string[] = [
    '=== EasyClaw Gateway Diagnostic ===',
    `Timestamp: ${new Date().toISOString()}`,
    `EasyClaw: ${app.getVersion()}`,
    `OS: ${platform()} ${release()} (${arch()})`,
    `Node (host): ${process.versions.node}`,
    `Electron: ${process.versions.electron ?? 'unknown'}`,
    `Supervisor status: ${supervisor.getStatus()} (gaveUp=${supervisor.isGaveUp()})`,
    `Last exit code: ${lastExit?.code ?? 'unknown'}`,
    portLine,
    '',
    '--- Last gateway stderr (200 lines, PII masked) ---',
    maskPii(stderrTail),
    '',
    '--- Last gateway stdout (50 lines, PII masked) ---',
    maskPii(stdoutLines || '<empty>'),
    '',
    '--- Recent restart history (1 hour) ---',
    formatHistory(),
    '',
    platformBlock
  ]

  return {
    timestamp: Date.now(),
    text: lines.join('\n')
  }
}
