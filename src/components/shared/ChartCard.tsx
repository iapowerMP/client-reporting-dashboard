import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChartCardProps {
  title: string
  /** Contenido opcional a la derecha del título (tabs, acciones…). */
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Padding interno; se puede desactivar para tablas a sangre. */
  noPadding?: boolean
}

/**
 * Contenedor de card estándar del dashboard: título arriba y contenido
 * (gráfico, tabla o grid) debajo. Bordes sutiles, sin sombras pesadas.
 */
export default function ChartCard({
  title,
  action,
  children,
  className,
  noPadding = false,
}: ChartCardProps) {
  return (
    <section
      className={cn(
        'rounded-card border border-border bg-card',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {action}
      </header>
      <div className={cn(noPadding ? '' : 'px-5 pb-5')}>{children}</div>
    </section>
  )
}
