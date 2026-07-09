import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  /** Habilita ordenación por esta columna. */
  sortable?: boolean
  /** Valor usado para ordenar (número o string). Por defecto row[key]. */
  accessor?: (row: T) => number | string
  /** Render personalizado de la celda. */
  render?: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  /** Clave única de fila para React. */
  rowKey: (row: T, index: number) => string | number
  className?: string
}

type SortDir = 'asc' | 'desc'

/**
 * Tabla de datos reutilizable con ordenación por columna. Scroll horizontal
 * en pantallas pequeñas y hover sutil por fila.
 */
export default function DataTable<T>({
  columns,
  data,
  rowKey,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    if (!sortKey) return data
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return data
    const accessor =
      col.accessor ?? ((row: T) => (row as Record<string, unknown>)[sortKey] as number | string)
    const copy = [...data]
    copy.sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      let cmp: number
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv), 'es')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [data, columns, sortKey, sortDir])

  const toggleSort = (col: Column<T>) => {
    if (!col.sortable) return
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(col.key)
      setSortDir('desc')
    }
  }

  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => {
              const active = sortKey === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  onClick={() => toggleSort(col)}
                  className={cn(
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-secondary',
                    alignClass(col.align),
                    col.sortable && 'cursor-pointer select-none hover:text-text-primary',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      col.align === 'right' && 'flex-row-reverse',
                      col.align === 'center' && 'justify-center',
                    )}
                  >
                    {col.header}
                    {col.sortable &&
                      (active ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-accent" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-accent" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      ))}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-b border-border/60 transition-colors last:border-0 hover:bg-white/[0.03]"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-text-primary',
                    alignClass(col.align),
                  )}
                >
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
