import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { DateRange } from '@/services/types'

export type { DateRange }
export type RangePreset = '7d' | '30d' | '90d' | 'custom'

interface DateRangeContextValue {
  preset: RangePreset
  range: DateRange
  label: string
  setPreset: (preset: '7d' | '30d' | '90d') => void
  setCustomRange: (from: string, to: string) => void
}

const DateRangeContext = createContext<DateRangeContextValue | null>(null)

export const MAX_CUSTOM_RANGE_DAYS = 92 // ~3 meses

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toIsoDate(d)
}

const PRESET_DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 6, '30d': 29, '90d': 89 }
const PRESET_LABELS: Record<'7d' | '30d' | '90d', string> = {
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
}

function formatEs(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Devuelve el periodo de la misma duración inmediatamente anterior a
 * `range` (p. ej. si range son los últimos 30 días, el resultado son los 30
 * días previos a esos) — para calcular la variación % de los KPIs. */
export function getPreviousRange(range: DateRange): DateRange {
  const start = new Date(range.from)
  const end = new Date(range.to)
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const prevEnd = new Date(start)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - (spanDays - 1))
  return { from: toIsoDate(prevStart), to: toIsoDate(prevEnd) }
}

/** Valida un rango personalizado: fin >= inicio (mínimo 1 día), fin no futuro,
 * y un máximo de ~3 meses de amplitud. Devuelve un mensaje de error o null. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!from || !to) return 'Selecciona fecha de inicio y de fin.'
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Fechas no válidas.'
  }
  if (end < start) return 'La fecha de fin debe ser posterior a la de inicio.'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (end > today) return 'La fecha de fin no puede ser futura.'
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (spanDays > MAX_CUSTOM_RANGE_DAYS) return 'El rango máximo es de 3 meses.'
  return null
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<RangePreset>('30d')
  const [custom, setCustom] = useState<DateRange>({ from: daysAgo(29), to: daysAgo(0) })

  const value = useMemo<DateRangeContextValue>(() => {
    const range: DateRange =
      preset === 'custom' ? custom : { from: daysAgo(PRESET_DAYS[preset]), to: daysAgo(0) }
    const label = preset === 'custom' ? `${formatEs(custom.from)} – ${formatEs(custom.to)}` : PRESET_LABELS[preset]
    return {
      preset,
      range,
      label,
      setPreset: (p) => setPresetState(p),
      setCustomRange: (from, to) => {
        setCustom({ from, to })
        setPresetState('custom')
      },
    }
  }, [preset, custom])

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext)
  if (!ctx) throw new Error('useDateRange debe usarse dentro de DateRangeProvider')
  return ctx
}
