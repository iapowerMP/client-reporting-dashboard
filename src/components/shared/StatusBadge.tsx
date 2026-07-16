import { cn } from '@/lib/utils'
import type { StatusVariant } from '@/data/catalog'

interface StatusBadgeProps {
  status: StatusVariant | string
  className?: string
}

/** Estilos por estado. */
const STYLES: Record<string, string> = {
  // Verdes (positivo)
  Activa: 'bg-positive/15 text-positive',
  Conectado: 'bg-positive/15 text-positive',
  Positivo: 'bg-positive/15 text-positive',
  Destacado: 'bg-positive/15 text-positive',
  Completado: 'bg-positive/15 text-positive',
  // Grises (neutro)
  Pausada: 'bg-white/10 text-text-secondary',
  Pendiente: 'bg-white/10 text-text-secondary',
  Próximamente: 'bg-white/5 text-text-secondary/80',
  // Rojos (error)
  Error: 'bg-negative/15 text-negative',
  // Amarillo (atención)
  Revisar: 'bg-accent/15 text-accent',
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLES[status] ?? 'bg-white/10 text-text-secondary',
        className,
      )}
    >
      {status}
    </span>
  )
}
