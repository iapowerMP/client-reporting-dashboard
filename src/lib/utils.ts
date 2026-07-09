/**
 * Utilidades de formato numérico en formato español:
 *   - Punto como separador de miles: 1.284.930
 *   - Coma como separador decimal: 2,22
 */

const esNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat('es-ES', options).format(value)

/** Entero con separador de miles: 1.284.930 */
export function formatNumber(value: number): string {
  return esNumber(Math.round(value))
}

/**
 * Decimal con separador de miles y coma decimal.
 * formatDecimal(2.22) => "2,22"
 */
export function formatDecimal(value: number, decimals = 2): string {
  return esNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Moneda en euros: 14.832€ (símbolo al final, estilo español) */
export function formatCurrency(value: number, decimals = 0): string {
  return `${esNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}€`
}

/** Porcentaje: formatPercent(2.22) => "2,22%" */
export function formatPercent(value: number, decimals = 2): string {
  return `${formatDecimal(value, decimals)}%`
}

/** ROAS: formatRoas(4.21) => "4,21x" */
export function formatRoas(value: number, decimals = 2): string {
  return `${formatDecimal(value, decimals)}x`
}

/**
 * Formato abreviado para ejes de gráficos: 1200 => "1,2k", 45000 => "45k"
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${formatDecimal(value / 1_000_000, 1).replace(',0', '')}M`
  }
  if (abs >= 1_000) {
    return `${formatDecimal(value / 1_000, 1).replace(',0', '')}k`
  }
  return formatNumber(value)
}

/**
 * Firma la variación con flecha y determina el signo lógico.
 * Devuelve el texto listo para pintar en un badge.
 */
export function formatDelta(
  value: number,
  suffix: '%' | 'pp' | '' = '%',
  decimals = 1,
): string {
  const arrow = value >= 0 ? '▲' : '▼'
  const magnitude =
    suffix === 'pp' || suffix === ''
      ? formatDecimal(Math.abs(value), decimals)
      : formatDecimal(Math.abs(value), decimals)
  return `${arrow} ${magnitude}${suffix}`
}

/** Une clases condicionalmente (mini clsx). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
