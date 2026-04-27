import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type RestartKind = 'auto' | 'manual'

export interface RestartEntry {
  ts: number
  kind: RestartKind
  success: boolean
  exitCode?: number | null
}

const HISTORY_CAP = 200
const WINDOW_MS = 60 * 60 * 1000

let cachedPath: string | null = null
let cached: RestartEntry[] | null = null

const getHistoryPath = (): string => {
  if (cachedPath) return cachedPath
  cachedPath = join(app.getPath('userData'), 'gateway-restart-history.json')
  return cachedPath
}

const load = (): RestartEntry[] => {
  if (cached) return cached
  try {
    const path = getHistoryPath()
    if (!existsSync(path)) {
      cached = []
      return cached
    }
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    cached = Array.isArray(parsed) ? parsed.slice(-HISTORY_CAP) : []
  } catch {
    cached = []
  }
  return cached
}

const save = (): void => {
  if (!cached) return
  try {
    writeFileSync(getHistoryPath(), JSON.stringify(cached.slice(-HISTORY_CAP)), {
      mode: 0o600
    })
  } catch {
    /* silent */
  }
}

export const recordRestart = (entry: RestartEntry): void => {
  const history = load()
  history.push(entry)
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP)
  save()
}

export const getRecentEntries = (sinceMs: number = WINDOW_MS): RestartEntry[] => {
  const cutoff = Date.now() - sinceMs
  return load().filter((e) => e.ts >= cutoff)
}

export const countAutoInLastHour = (): number =>
  getRecentEntries(WINDOW_MS).filter((e) => e.kind === 'auto').length

export const getAllEntries = (): RestartEntry[] => load().slice()
