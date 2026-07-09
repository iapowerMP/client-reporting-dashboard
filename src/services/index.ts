/**
 * Punto único de acceso a los datos del dashboard. Selecciona el proveedor
 * activo según la variable de entorno VITE_DATA_MODE:
 *   - "mock" (por defecto): datos ficticios de mockData.ts
 *   - "live": datos reales vía endpoints /api/*
 *
 * Para cambiar de modo en una copia del proyecto basta con definir
 * VITE_DATA_MODE=live en las variables de entorno de Vercel.
 */
import type { DataMode, DataProvider } from './types'
import { mockProvider } from './mockProvider'
import { liveProvider } from './liveProvider'

export function getDataMode(): DataMode {
  const mode = import.meta.env.VITE_DATA_MODE
  return mode === 'live' ? 'live' : 'mock'
}

export function getProvider(): DataProvider {
  return getDataMode() === 'live' ? liveProvider : mockProvider
}

export * from './types'
