import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { platform } from 'os'
import { getPathEnv, findBin } from './path-utils'
import { WSL_NVM_INIT } from './wsl-utils'
import { probeAlive } from './gateway-probes'
import * as logRotator from './gateway-log-rotator'
import { countAutoInLastHour, recordRestart } from './gateway-restart-history'
import { t } from '../../shared/i18n/main'

export type GatewayStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'restarting'
  | 'stopped'
  | 'failed'
  | 'gave_up'

export interface ExitInfo {
  code: number | null
  stderrTail: string
  ts: number
}

export interface StartResult {
  status: 'started' | 'error'
  error?: string
}

interface SupervisorEvents {
  log: (msg: string) => void
  died: (info: ExitInfo) => void
  started: () => void
  failed: (error: string) => void
  restarting: (payload: { attempt: number; delayMs: number }) => void
  restarted: () => void
  gave_up: (payload: { attempts: number }) => void
  'status-changed': (status: GatewayStatus) => void
}

const HEALTH_LOOP_MS = 5000
const BOOT_PROBE_INTERVAL_MS = 500
const BOOT_PROBE_MAX_MS = 15000
const STDERR_TAIL_LINES = 200

// Backoff schedule for auto-restart attempts after a crash.
// Index 0 is the first attempt (immediate). Capped at index 4 = 60 s.
const BACKOFF_SCHEDULE_MS = [0, 2000, 5000, 15000, 60000]
const MAX_AUTO_RESTARTS_PER_HOUR = 5

const isWindows = platform() === 'win32'

class GatewaySupervisor extends EventEmitter {
  private status: GatewayStatus = 'idle'
  private wslChild: ChildProcess | null = null
  private wslStderrBuffer: string[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private lastExit: ExitInfo | null = null
  private starting: Promise<StartResult> | null = null
  private stopping: Promise<void> | null = null
  private gaveUp = false
  private autoRestartTimer: NodeJS.Timeout | null = null
  private suppressAutoRestart = false

  override on<K extends keyof SupervisorEvents>(event: K, listener: SupervisorEvents[K]): this {
    return super.on(event, listener)
  }

  override emit<K extends keyof SupervisorEvents>(
    event: K,
    ...args: Parameters<SupervisorEvents[K]>
  ): boolean {
    return super.emit(event, ...args)
  }

  getStatus(): GatewayStatus {
    return this.status
  }

  lastExitInfo(): ExitInfo | null {
    return this.lastExit
  }

  async isAlive(): Promise<boolean> {
    return probeAlive()
  }

  async start(kind: 'manual' | 'auto' = 'manual'): Promise<StartResult> {
    if (kind === 'manual') {
      // Manual user action clears the lock so the user can recover from gave_up.
      this.gaveUp = false
      this.cancelPendingAutoRestart()
    }
    if (this.starting) return this.starting
    this.starting = this.startInternal(kind).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  async stop(): Promise<void> {
    // Treat explicit stop as user intent — do not let a death from the
    // termination itself trigger auto-restart.
    this.suppressAutoRestart = true
    this.cancelPendingAutoRestart()
    if (this.stopping) return this.stopping
    this.stopping = this.stopInternal().finally(() => {
      this.stopping = null
      this.suppressAutoRestart = false
    })
    return this.stopping
  }

  isGaveUp(): boolean {
    return this.gaveUp
  }

  async restart(): Promise<StartResult> {
    try {
      await this.stop()
    } catch {
      /* already stopped */
    }
    await this.waitUntilGone(5000)
    return this.start()
  }

  startHealthLoop(): void {
    if (this.healthTimer) return
    this.healthTimer = setInterval(() => {
      void this.healthTick()
    }, HEALTH_LOOP_MS)
  }

  stopHealthLoop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  // ---------- internals ----------

  private setStatus(next: GatewayStatus): void {
    if (this.status === next) return
    this.status = next
    this.emit('status-changed', next)
  }

  private logBoth(msg: string, stream: logRotator.LogStream = 'meta'): void {
    if (!msg) return
    logRotator.writeLine(stream, msg)
    this.emit('log', msg)
  }

  private async startInternal(kind: 'manual' | 'auto'): Promise<StartResult> {
    if (this.status === 'running' && (await this.isAlive())) {
      return { status: 'started' }
    }
    this.setStatus(kind === 'auto' ? 'restarting' : 'starting')
    try {
      const result = isWindows ? await this.startWsl() : await this.startMac()
      if (result.status === 'started') {
        const ok = await this.waitUntilAlive()
        if (!ok) {
          this.setStatus('failed')
          recordRestart({ ts: Date.now(), kind, success: false })
          this.emit('failed', 'gateway did not become alive within 15s')
          return { status: 'error', error: 'boot probe timeout' }
        }
        this.setStatus('running')
        recordRestart({
          ts: Date.now(),
          kind,
          success: true,
          exitCode: this.lastExit?.code ?? null
        })
        this.emit('started')
        if (kind === 'auto') this.emit('restarted')
        this.startHealthLoop()
      } else {
        this.setStatus('failed')
        recordRestart({ ts: Date.now(), kind, success: false })
        this.emit('failed', result.error ?? 'unknown error')
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('failed')
      recordRestart({ ts: Date.now(), kind, success: false })
      this.emit('failed', msg)
      return { status: 'error', error: msg }
    }
  }

  private cancelPendingAutoRestart(): void {
    if (this.autoRestartTimer) {
      clearTimeout(this.autoRestartTimer)
      this.autoRestartTimer = null
    }
  }

  private scheduleAutoRestart(): void {
    if (this.suppressAutoRestart || this.gaveUp) return
    if (this.autoRestartTimer) return // already pending
    const attempts = countAutoInLastHour()
    if (attempts >= MAX_AUTO_RESTARTS_PER_HOUR) {
      this.gaveUp = true
      this.setStatus('gave_up')
      this.emit('gave_up', { attempts })
      return
    }
    const delayMs = BACKOFF_SCHEDULE_MS[Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1)]
    this.emit('restarting', { attempt: attempts + 1, delayMs })
    this.setStatus('restarting')
    this.autoRestartTimer = setTimeout(() => {
      this.autoRestartTimer = null
      void this.start('auto').catch(() => undefined)
    }, delayMs)
  }

  private async stopInternal(): Promise<void> {
    this.stopHealthLoop()
    if (isWindows) {
      await this.stopWsl()
    } else {
      await this.stopMac()
    }
    this.setStatus('idle')
  }

  private async waitUntilAlive(): Promise<boolean> {
    const deadline = Date.now() + BOOT_PROBE_MAX_MS
    while (Date.now() < deadline) {
      if (await this.isAlive()) return true
      await sleep(BOOT_PROBE_INTERVAL_MS)
    }
    return false
  }

  private async waitUntilGone(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!(await this.isAlive())) return
      await sleep(500)
    }
  }

  private async healthTick(): Promise<void> {
    if (this.starting || this.stopping) return
    if (this.status !== 'running') return
    const alive = await this.isAlive()
    if (alive) return
    // Transition: running → stopped, emit died
    this.setStatus('stopped')
    this.lastExit = {
      code: null,
      stderrTail: this.wslStderrBuffer.slice(-STDERR_TAIL_LINES).join('\n'),
      ts: Date.now()
    }
    this.logBoth(t('gateway.processExit', { code: 'unknown' }))
    this.emit('died', this.lastExit)
    this.stopHealthLoop()
    this.scheduleAutoRestart()
  }

  // ---------- macOS adapter ----------

  private async startMac(): Promise<StartResult> {
    try {
      await this.runOpenclawCli(['gateway', 'start'])
      await this.runOpenclawCli(['doctor', '--fix']).catch(() => undefined)
      return { status: 'started' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isServiceMissing =
        msg.includes('not loaded') || msg.includes('not installed') || msg.includes('bootstrap')
      if (!isServiceMissing) return { status: 'error', error: msg }
      // Auto-install launchd service then retry
      this.logBoth(t('gateway.notInstalledRetry'))
      try {
        await this.runOpenclawCli(['gateway', 'install'])
        await this.runOpenclawCli(['gateway', 'start'])
        await this.runOpenclawCli(['doctor', '--fix']).catch(() => undefined)
        return { status: 'started' }
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        return { status: 'error', error: retryMsg }
      }
    }
  }

  private async stopMac(): Promise<void> {
    try {
      await this.runOpenclawCli(['gateway', 'stop'])
    } catch {
      /* already stopped */
    }
  }

  private runOpenclawCli(args: string[]): Promise<string> {
    const openclaw = findBin('openclaw')
    return new Promise((resolve, reject) => {
      const child = spawn(openclaw, args, { env: getPathEnv() })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => {
        const msg = d.toString()
        stdout += msg
        const trimmed = msg.trim()
        if (trimmed) this.logBoth(trimmed, 'stdout')
      })
      child.stderr.on('data', (d) => {
        const msg = d.toString()
        stderr += msg
        const trimmed = msg.trim()
        if (trimmed) this.logBoth(trimmed, 'stderr')
      })
      child.on('close', (code) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || `exit code ${code}`))
      })
      child.on('error', reject)
    })
  }

  // ---------- WSL adapter ----------

  private async startWsl(): Promise<StartResult> {
    if (this.wslChild) {
      try {
        this.wslChild.kill()
      } catch {
        /* ignore */
      }
      this.wslChild = null
    }
    await this.killWslOpenclaw()
    await sleep(1000)
    this.wslStderrBuffer = []

    return new Promise<StartResult>((resolve) => {
      const child = spawn(
        'wsl',
        [
          '-d',
          'Ubuntu',
          '-u',
          'root',
          '--',
          'bash',
          '-lc',
          `${WSL_NVM_INIT}NODE_OPTIONS=--dns-result-order=ipv4first openclaw gateway run`
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )

      this.wslChild = child
      let resolved = false

      child.stdout.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) this.logBoth(msg, 'stdout')
        if (!resolved) {
          resolved = true
          resolve({ status: 'started' })
        }
      })

      child.stderr.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) {
          this.logBoth(msg, 'stderr')
          this.wslStderrBuffer.push(msg)
          if (this.wslStderrBuffer.length > STDERR_TAIL_LINES * 2) {
            this.wslStderrBuffer = this.wslStderrBuffer.slice(-STDERR_TAIL_LINES)
          }
        }
        if (!resolved) {
          resolved = true
          resolve({ status: 'started' })
        }
      })

      child.on('close', (code) => {
        const wasOurChild = this.wslChild === child
        if (wasOurChild) this.wslChild = null
        const tail = this.wslStderrBuffer.slice(-STDERR_TAIL_LINES).join('\n')
        this.lastExit = { code, stderrTail: tail, ts: Date.now() }
        this.logBoth(t('gateway.processExit', { code: code ?? 'unknown' }))
        if (code !== 0 && tail) {
          this.logBoth(`${t('gateway.errorDetail')}\n${tail}`)
        }
        if (!resolved) {
          resolved = true
          resolve(
            code === 0
              ? { status: 'started' }
              : { status: 'error', error: tail || `exit code ${code}` }
          )
        }
        if (wasOurChild && this.status === 'running') {
          this.setStatus('stopped')
          this.emit('died', this.lastExit)
          this.stopHealthLoop()
          this.scheduleAutoRestart()
        }
      })

      child.on('error', (err) => {
        if (this.wslChild === child) this.wslChild = null
        this.logBoth(t('gateway.error', { message: err.message }))
        if (!resolved) {
          resolved = true
          resolve({ status: 'error', error: err.message })
        }
      })
    })
  }

  private async stopWsl(): Promise<void> {
    if (this.wslChild) {
      try {
        this.wslChild.kill()
      } catch {
        /* ignore */
      }
      this.wslChild = null
    }
    await this.killWslOpenclaw()
    await sleep(1000)
  }

  private killWslOpenclaw(): Promise<void> {
    return new Promise((resolve) => {
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
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let supervisor: GatewaySupervisor | null = null

export const getSupervisor = (): GatewaySupervisor => {
  if (!supervisor) supervisor = new GatewaySupervisor()
  return supervisor
}

export type { GatewaySupervisor }
