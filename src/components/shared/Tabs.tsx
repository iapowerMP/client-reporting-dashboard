import { cn } from '@/lib/utils'

interface TabsProps<T extends string> {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
  className?: string
}

/**
 * Fila de tabs reutilizable: el tab activo muestra texto blanco con
 * subrayado de acento de 2px.
 */
export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1 border-b border-border',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab === active
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-accent text-white'
                : 'border-transparent text-text-secondary hover:text-white',
            )}
          >
            {tab}
          </button>
        )
      })}
    </div>
  )
}
