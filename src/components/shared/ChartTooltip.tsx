import type { TooltipProps } from 'recharts'

/**
 * Tooltip personalizado con el estilo dark del dashboard.
 * `formatter` permite dar formato a cada valor (moneda, número, etc.).
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: TooltipProps<number, string> & {
  formatter?: (value: number, name: string) => string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-control border border-border bg-[#12141b] px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold text-white">{label}</p>}
      <div className="space-y-0.5">
        {payload.map((entry, i) => {
          const value = entry.value as number
          const name = (entry.name as string) ?? ''
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-text-secondary">{name}:</span>
              <span className="font-medium text-white">
                {formatter ? formatter(value, name) : value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
