import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync
} from 'fs'
import { join } from 'path'

const RETENTION_DAYS = 7
const TOTAL_CAP_BYTES = 50 * 1024 * 1024
const FILE_PREFIX = 'gateway-'
const FILE_SUFFIX = '.log'

let cachedLogsDir: string | null = null

const getLogsDir = (): string => {
  if (cachedLogsDir) return cachedLogsDir
  const dir = join(app.getPath('userData'), 'logs')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore — writeLine will silently fail too */
  }
  cachedLogsDir = dir
  return dir
}

const dateStamp = (d: Date = new Date()): string => {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export const getLogPath = (date: Date = new Date()): string =>
  join(getLogsDir(), `${FILE_PREFIX}${dateStamp(date)}${FILE_SUFFIX}`)

let lastRetentionRunMs = 0
const RETENTION_INTERVAL_MS = 60 * 60 * 1000

const enforceRetention = (): void => {
  const now = Date.now()
  if (now - lastRetentionRunMs < RETENTION_INTERVAL_MS) return
  lastRetentionRunMs = now
  try {
    const dir = getLogsDir()
    const files = readdirSync(dir)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
      .map((name) => {
        const full = join(dir, name)
        const stat = statSync(full)
        return { name, full, mtime: stat.mtimeMs, size: stat.size }
      })
      .sort((a, b) => b.mtime - a.mtime)

    const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000
    let runningTotal = 0
    for (const f of files) {
      runningTotal += f.size
      const tooOld = f.mtime < cutoff
      const overCap = runningTotal > TOTAL_CAP_BYTES
      if (tooOld || overCap) {
        try {
          unlinkSync(f.full)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export type LogStream = 'stdout' | 'stderr' | 'meta'

export const writeLine = (stream: LogStream, msg: string): void => {
  if (!msg) return
  try {
    const ts = new Date().toISOString()
    const line = `[${ts}] [${stream}] ${msg}\n`
    appendFileSync(getLogPath(), line)
    enforceRetention()
  } catch {
    /* silent — never throw from logging path */
  }
}

export const flush = (): void => {
  // appendFileSync is synchronous — no buffer to flush. Hook left for future async impl.
  enforceRetention()
}

export const getRecentLines = (n: number, stream?: LogStream): string[] => {
  try {
    const dir = getLogsDir()
    const files = readdirSync(dir)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
      .sort()
    const buffer: string[] = []
    for (let i = files.length - 1; i >= 0 && buffer.length < n; i--) {
      const full = join(dir, files[i])
      try {
        const lines = readFileSync(full, 'utf8').split('\n').filter(Boolean)
        for (let j = lines.length - 1; j >= 0 && buffer.length < n; j--) {
          if (!stream || lines[j].includes(`[${stream}]`)) {
            buffer.unshift(lines[j])
          }
        }
      } catch {
        /* ignore broken file */
      }
    }
    return buffer
  } catch {
    return []
  }
}
