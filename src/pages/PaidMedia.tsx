import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import Tabs from '@/components/shared/Tabs'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PlatformBadge from '@/components/shared/PlatformBadge'
import StatusBadge from '@/components/shared/StatusBadge'
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRoas,
} from '@/lib/utils'
import {
  type PaidTab,
  PAID_PLATFORMS,
  PAID_TAB_TO_CONNECTION,
  computePaidKpis,
  type Campaign,
} from '@/data/mockData'
import { useReportConfig } from '@/lib/reportConfig'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import NotContracted from '@/components/shared/NotContracted'

type TopMetric = 'inversion' | 'impresiones' | 'clics' | 'conversiones' | 'roas'

const TOP_METRIC_OPTIONS: { key: TopMetric; label: string }[] = [
  { key: 'inversion', label: 'Inversión' },
  { key: 'impresiones', label: 'Impresiones' },
  { key: 'clics', label: 'Clics' },
  { key: 'conversiones', label: 'Conversiones' },
  { key: 'roas', label: 'ROAS' },
]

/** Paleta para el donut de "Distribución por campaña" (pestañas de plataforma). */
const CAMPAIGN_PALETTE = ['#F2FE54', '#60A5FA', '#A78BFA', '#34D399', '#FB923C', '#F472B6', '#9CA3AF']

function formatTopValue(metric: TopMetric, value: number): string {
  switch (metric) {
    case 'inversion':
      return formatCurrency(value)
    case 'roas':
      return formatRoas(value, 1)
    default:
      return formatNumber(value)
  }
}

const campaignColumns: Column<Campaign>[] = [
  {
    key: 'platform',
    header: 'Plataforma',
    sortable: true,
    render: (r) => <PlatformBadge platform={r.platform} />,
  },
  { key: 'name', header: 'Campaña', sortable: true },
  {
    key: 'status',
    header: 'Estado',
    sortable: true,
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'inversion',
    header: 'Inversión',
    align: 'right',
    sortable: true,
    render: (r) => formatCurrency(r.inversion),
  },
  {
    key: 'impresiones',
    header: 'Impr.',
    align: 'right',
    sortable: true,
    render: (r) => formatNumber(r.impresiones),
  },
  {
    key: 'clics',
    header: 'Clics',
    align: 'right',
    sortable: true,
    render: (r) => formatNumber(r.clics),
  },
  {
    key: 'ctr',
    header: 'CTR',
    align: 'right',
    sortable: true,
    render: (r) => formatPercent(r.ctr),
  },
  {
    key: 'cpc',
    header: 'CPC',
    align: 'right',
    sortable: true,
    render: (r) => formatCurrency(r.cpc, 2),
  },
  {
    key: 'conversiones',
    header: 'Conv.',
    align: 'right',
    sortable: true,
    render: (r) => formatNumber(r.conversiones),
  },
  {
    key: 'roas',
    header: 'ROAS',
    align: 'right',
    sortable: true,
    render: (r) => formatRoas(r.roas, 1),
  },
]

export default function PaidMedia() {
  const { clientSlug = '' } = useParams()
  const { isVisible } = useReportConfig()
  const { range, label: rangeLabel } = useDateRange()
  const [tab, setTab] = useState<PaidTab>('Todas')
  const [topMetric, setTopMetric] = useState<TopMetric>('roas')
  const { data, loading, error } = useAsyncData(
    () => getProvider().getPaid(clientSlug, range),
    [clientSlug, range.from, range.to],
  )

  // Solo se muestran las plataformas activadas en Configuración.
  const platformTabs = PAID_PLATFORMS.filter((p) =>
    isVisible(PAID_TAB_TO_CONNECTION[p]),
  )
  const visibleTabs: PaidTab[] = ['Todas', ...platformTabs]
  const activeTab: PaidTab = visibleTabs.includes(tab) ? tab : 'Todas'
  const visiblePlatforms: string[] = [...platformTabs]

  if (platformTabs.length === 0) return <NotContracted label="Paid Media" />

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const kpis = computePaidKpis(activeTab, visiblePlatforms, data.campaigns)
  const rows =
    activeTab === 'Todas'
      ? data.campaigns.filter((c) => visiblePlatforms.includes(c.platform))
      : data.campaigns.filter((c) => c.platform === activeTab)

  // En "Todas" se compara inversión por plataforma; en una pestaña de
  // plataforma concreta, ese mismo gráfico no tendría sentido (una sola
  // plataforma), así que se sustituye por el reparto por campaña de esa
  // plataforma — sin mezclar nunca datos de otra.
  const visibleDistribution =
    activeTab === 'Todas'
      ? data.distribution.filter((d) => visiblePlatforms.includes(d.name))
      : (() => {
          const total = rows.reduce((s, r) => s + r.inversion, 0)
          return [...rows]
            .sort((a, b) => b.inversion - a.inversion)
            .map((r, i) => ({
              name: r.name,
              value: r.inversion,
              percent: total ? `${((r.inversion / total) * 100).toFixed(1).replace('.', ',')}%` : '0,0%',
              color: CAMPAIGN_PALETTE[i % CAMPAIGN_PALETTE.length],
            }))
        })()
  const distributionTotal = formatCurrency(
    visibleDistribution.reduce((s, d) => s + d.value, 0),
  )
  const distributionTitle =
    activeTab === 'Todas' ? 'Distribución por plataforma' : `Distribución por campaña — ${activeTab}`

  // Serie exclusiva de la plataforma activa (o el total combinado en "Todas").
  const invConvData =
    activeTab === 'Todas' ? data.invConv : data.invConvByPlatform[activeTab] ?? []

  const topMetricLabel = TOP_METRIC_OPTIONS.find((o) => o.key === topMetric)?.label ?? 'ROAS'
  const topN = [...rows]
    .sort((a, b) => b[topMetric] - a[topMetric])
    .slice(0, 5)
    .map((c) => ({ name: c.name, value: c[topMetric] }))

  return (
    <div className="space-y-6">
      {/* Tabs de plataforma */}
      <Tabs tabs={visibleTabs} active={activeTab} onChange={setTab} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} highlight={kpi.label === 'ROAS'} />
        ))}
      </div>

      {/* Gráfico 1: Inversión vs Conversiones */}
      <ChartCard title={`Inversión vs Conversiones — ${rangeLabel}`}>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={invConvData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="invGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F2FE54" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#F2FE54" stopOpacity={0} />
                </linearGradient>
              </defs>
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
                yAxisId="left"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v, name) =>
                      name === 'Inversión' ? formatCurrency(v) : formatNumber(v)
                    }
                  />
                }
                cursor={{ stroke: '#2A2D36' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="inversion"
                name="Inversión"
                stroke="#F2FE54"
                strokeWidth={2}
                fill="url(#invGradient)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="conversiones"
                name="Conversiones"
                stroke="#FFFFFF"
                strokeWidth={2}
                dot={{ r: 2, fill: '#FFFFFF' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Fila de 2 gráficos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gráfico 2: Distribución por plataforma (donut) */}
        <ChartCard title={distributionTitle}>
          <div className="relative h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visibleDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={2}
                  stroke="none"
                >
                  {visibleDistribution.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatCurrency(v)} />}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Etiqueta central del donut */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-white">
                {distributionTotal}
              </span>
              <span className="text-xs text-text-secondary">Total</span>
            </div>
          </div>
          {/* Leyenda */}
          <div className="mt-2 flex flex-wrap justify-center gap-4">
            {visibleDistribution.map((slice) => (
              <div key={slice.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-text-secondary">
                  {slice.name} · {slice.percent}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        {/* Gráfico 3: Top 5 campañas por métrica seleccionable (barras horizontales) */}
        <ChartCard
          title={`Top 5 campañas por ${topMetricLabel}`}
          action={
            <select
              value={topMetric}
              onChange={(e) => setTopMetric(e.target.value as TopMetric)}
              className="rounded-control border border-border bg-base px-2 py-1 text-xs font-medium text-text-primary focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            >
              {TOP_METRIC_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topN}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#2A2D36"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#2A2D36' }}
                  tickFormatter={(v) => formatTopValue(topMetric, v as number)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={130}
                />
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatTopValue(topMetric, v as number)} />}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" name={topMetricLabel} fill="#F2FE54" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Tabla de campañas */}
      <ChartCard title="Detalle de campañas" noPadding>
        <DataTable
          columns={campaignColumns}
          data={rows}
          rowKey={(r) => `${r.platform}-${r.name}`}
        />
      </ChartCard>
    </div>
  )
}
