/**
 * Punto único de acceso a los datos del dashboard: siempre datos reales vía
 * /api/*.
 */
import type { DataProvider } from './types'
import { liveProvider } from './liveProvider'

export function getProvider(): DataProvider {
  return liveProvider
}

export * from './types'
