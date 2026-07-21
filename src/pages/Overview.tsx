import { useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { DollarSign, Search, Smartphone, type LucideIcon } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import { cn, formatCompact, formatCurrency, formatNumber } from '@/lib/utils'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { useReportConfig } from '@/lib/reportConfig'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import {
  type SummaryCard,
  PAID_TAB_TO_CONNECTION,
  SEO_TAB_TO_CONNECTION,
  SOCIAL_TAB_TO_CONNECTION,
} from '@/data/catalog'

const CARD_ICONS: Record<SummaryCard['key'], LucideIcon> = {
  paid: DollarSign,
  seo: Search,
  social: Smartphone,
}

function SummaryCardView({ card }: { card: SummaryCard }) {
  const Icon = CARD_ICONS[card.key]
  const sparkData = card.sparkline.map((v, i) => ({ i, v }))

  return (
    <div className="rounded-card border border-border bg-card p-5 transition-colors hover:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-secondary">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium">{card.title}</span>
        </div>
        <span
          className={cn(
            'text-xs font-semibold',
            card.deltaPositive ? 'text-positive' : 'text-negative',
          )}
        >
          {card.delta}
        </span>
      </div>

      <p className="mt-3 text-2xl font-bold text-white">{card.value}</p>

      {/* Sparkline */}
      <div className="mt-3 h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
            <Line
              type="monotone"
              dataKey="v"
              stroke="#F2FE54"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-xs text-text-secondary">{card.footer}</p>
    </div>
  )
}

export default function Overview() {
  const { clientSlug = '' } = useParams()
  const { range } = useDateRange()
  const { isVisible } = useReportConfig()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getOverview(clientSlug, range),
    [clientSlug, range.from, range.to],
  )

  const categoryVisible: Record<SummaryCard['key'], boolean> = {
    paid: Object.values(PAID_TAB_TO_CONNECTION).some(isVisible),
    seo: Object.values(SEO_TAB_TO_CONNECTION).some(isVisible),
    social: Object.values(SOCIAL_TAB_TO_CONNECTION).some(isVisible),
  }

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const { globalPerformance } = data
  const summary = data.summary.filter((card) => categoryVisible[card.key])

  return (
    <div className="space-y-6">
      {/* 3 cards de resumen */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {summary.map((card) => (
          <SummaryCardView key={card.key} card={card} />
        ))}
      </div>

      {/* Gráfico principal: evolución de inversión y conversiones de Paid Media */}
      <ChartCard title="Evolución — Inversión y conversiones">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={globalPerformance}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#2A2D36' }}
                interval={4}
              />
              <YAxis
                yAxisId="inversion"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <YAxis
                yAxisId="conversiones"
                orientation="right"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v, name) => (name === 'Inversión' ? formatCurrency(v) : formatNumber(v))}
                  />
                }
                cursor={{ stroke: '#2A2D36' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                iconType="plainline"
              />
              <Line
                yAxisId="inversion"
                type="monotone"
                dataKey="inversion"
                name="Inversión"
                stroke="#F2FE54"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="conversiones"
                type="monotone"
                dataKey="conversiones"
                name="Conversiones"
                stroke="#60A5FA"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  )
}
