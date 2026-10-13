import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Icono de información con tooltip al pasar el cursor por encima — explica
 * cómo se calcula un dato (KPI, columna de tabla…). Puramente CSS
 * (group-hover), sin estado ni JS adicional.
 */
export default function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('group relative inline-flex shrink-0 align-middle', className)}>
      <Info className="h-3.5 w-3.5 text-text-secondary/60 transition-colors hover:text-text-secondary" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-control border border-border bg-base px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-text-secondary opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}
