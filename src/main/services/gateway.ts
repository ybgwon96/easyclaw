import { getSupervisor, type StartResult } from './gateway-supervisor'

export type GatewayResult = StartResult

let activeLogListener: ((msg: string) => void) | null = null

export const setGatewayLogCallback = (cb: ((msg: string) => void) | null): void => {
  const supervisor = getSupervisor()
  if (activeLogListener) {
    supervisor.off('log', activeLogListener)
    activeLogListener = null
  }
  if (cb) {
    activeLogListener = cb
    supervisor.on('log', cb)
  }
}

export const waitUntilStopped = async (timeoutMs = 5000): Promise<void> => {
  const supervisor = getSupervisor()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await supervisor.isAlive())) return
    await new Promise((r) => setTimeout(r, 500))
  }
}

export const startGateway = (): Promise<GatewayResult> => getSupervisor().start()

export const stopGateway = async (): Promise<string> => {
  await getSupervisor().stop()
  return 'stopped'
}

export const restartGateway = (): Promise<GatewayResult> => getSupervisor().restart()

export const getGatewayStatus = async (): Promise<'running' | 'stopped'> => {
  const supervisor = getSupervisor()
  if (await supervisor.isAlive()) return 'running'
  return 'stopped'
}
