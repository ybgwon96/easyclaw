import { spawn } from 'child_process'
import { platform } from 'os'
import { getPathEnv } from './path-utils'
import { WSL_NVM_INIT } from './wsl-utils'

export const GATEWAY_PORT = 18789

// macOS launchd identity for the OpenClaw gateway daemon.
// Mirrors the value written by onboarder.ts when patching the plist.
export const LAUNCHD_LABEL = 'ai.openclaw.gateway'

const runShort = (
  cmd: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: env ?? process.env })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr })
    })
  })

export const probeMacLaunchd = async (): Promise<boolean> => {
  const uid = process.getuid?.() ?? 0
  // launchctl print returns multi-line output incl. "state = running"
  const printResult = await runShort(
    'launchctl',
    ['print', `gui/${uid}/${LAUNCHD_LABEL}`],
    2000,
    getPathEnv()
  )
  if (printResult.code === 0 && /state\s*=\s*running/.test(printResult.stdout)) {
    return true
  }
  // Fallback: launchctl list <label> exits 0 with PID column when running
  const listResult = await runShort('launchctl', ['list', LAUNCHD_LABEL], 2000, getPathEnv())
  if (listResult.code === 0) {
    const pid = listResult.stdout.trim().split(/\s+/)[0]
    if (pid && /^\d+$/.test(pid)) return true
  }
  return false
}

export const probeMacPort = async (port = GATEWAY_PORT): Promise<boolean> => {
  const result = await runShort('lsof', ['-i', `:${port}`, '-t'], 2000, getPathEnv())
  if (result.code !== 0) return false
  const firstLine = result.stdout.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 0
}

export const probeMacAlive = async (port = GATEWAY_PORT): Promise<boolean> => {
  // Either launchd state OR an actual port listener counts as alive.
  // launchd "running" without a listener can briefly happen during boot.
  const [launchd, port_] = await Promise.all([probeMacLaunchd(), probeMacPort(port)])
  return launchd || port_
}

const WSL_PROBE_SCRIPT = (port: number): string => {
  // 18789 in hex = 495D (lowercase). /proc/net/tcp uses uppercase, normalize.
  const hex = port.toString(16).toUpperCase().padStart(4, '0')
  return [
    `(ss -ltn 2>/dev/null | awk '$4 ~ /:${port}$/ {print "OK"; exit 0}')`,
    `(lsof -i :${port} -t 2>/dev/null | head -n1 | grep -q . && echo OK)`,
    `(awk '$2 ~ /:${hex}$/ {print "OK"; exit}' /proc/net/tcp /proc/net/tcp6 2>/dev/null)`
  ].join(' || ')
}

const runWslShort = (script: string, timeoutMs: number): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn('wsl', [
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--',
      'bash',
      '-lc',
      WSL_NVM_INIT + script
    ])
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, timeoutMs)
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.on('close', () => {
      clearTimeout(timer)
      resolve(stdout)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(stdout)
    })
  })

export const probeWslAlive = async (port = GATEWAY_PORT): Promise<boolean> => {
  const out = await runWslShort(WSL_PROBE_SCRIPT(port), 3000)
  return /\bOK\b/.test(out)
}

export const probeAlive = async (): Promise<boolean> => {
  if (platform() === 'win32') return probeWslAlive()
  return probeMacAlive()
}
