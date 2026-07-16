import { cn } from '@/lib/utils'
import type { KpiData } from '@/data/catalog'

interface KpiCardProps extends KpiData {
  /** Resalta la card con un borde de acento (usar con moderación). */
  highlight?: boolean
  className?: string
}

/**
 * Card de KPI reutilizable: valor principal grande, variación con color
 * y label descriptivo.
 */
export default function KpiCard({
  label,
  value,
  delta,
  deltaPositive = true,
  highlight = false,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-card border bg-card p-4 transition-colors hover:bg-white/[0.03]',
        highlight ? 'border-accent/40' : 'border-border',
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold leading-tight text-text-primary">
        {value}
      </p>
      {delta && (
        <p
          className={cn(
            'mt-1 text-xs font-semibold',
            deltaPositive ? 'text-positive' : 'text-negative',
          )}
        >
          {delta}
        </p>
      )}
    </div>
  )
}
