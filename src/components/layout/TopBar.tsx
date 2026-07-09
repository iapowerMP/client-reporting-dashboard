import { useState } from 'react'
import { Menu, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TopBarProps {
  title: string
  onOpenSidebar: () => void
}

const RANGES = ['7d', '30d', '90d'] as const
type Range = (typeof RANGES)[number]

export default function TopBar({ title, onOpenSidebar }: TopBarProps) {
  // El rango cambia visualmente pero no filtra datos (mockup).
  const [range, setRange] = useState<Range>('30d')

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-base/90 backdrop-blur">
      <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSidebar}
            className="rounded-control p-1.5 text-text-secondary hover:bg-white/10 md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Selector de rango de fechas */}
          <div className="flex items-center rounded-control border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors',
                  range === r
                    ? 'bg-accent text-black'
                    : 'text-text-secondary hover:text-white',
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Botón exportar (outline) */}
          <button
            className="inline-flex items-center gap-2 rounded-control border border-border bg-card px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>
    </header>
  )
}
