import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  LineChart,
  BarChart,
  Bar,
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
import { formatCompact, formatDecimal, formatNumber, formatPercent } from '@/lib/utils'
import {
  SEO_TAB_TO_CONNECTION,
  type SeoTab,
  type GscRow,
} from '@/data/mockData'
import { useReportConfig } from '@/lib/reportConfig'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import NotContracted from '@/components/shared/NotContracted'

const gscColumns = (firstHeader: string): Column<GscRow>[] => [
  { key: 'label', header: firstHeader, sortable: true },
  {
    key: 'clics',
    header: 'Clics',
    align: 'right',
    sortable: true,
    render: (r) => formatNumber(r.clics),
  },
  {
    key: 'impresiones',
    header: 'Impresiones',
    align: 'right',
    sortable: true,
    render: (r) => formatNumber(r.impresiones),
  },
  {
    key: 'ctr',
    header: 'CTR',
    align: 'right',
    sortable: true,
    render: (r) => formatPercent(r.ctr),
  },
  {
    key: 'posicion',
    header: 'Posición',
    align: 'right',
    sortable: true,
    render: (r) => formatDecimal(r.posicion, 1),
  },
]

export default function Seo() {
  const { clientSlug = '' } = useParams()
  const { isVisible } = useReportConfig()
  const [tab, setTab] = useState<SeoTab>('Overview')
  const { range } = useDateRange()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getSeo(clientSlug, range),
    [clientSlug, range.from, range.to],
  )

  // "Overview" siempre visible; el resto de herramientas según Configuración.
  const toolTabs = (['GA4', 'Search Console', 'Semrush'] as SeoTab[]).filter(
    (t) => isVisible(SEO_TAB_TO_CONNECTION[t]),
  )
  const visibleTabs: SeoTab[] = ['Overview', ...toolTabs]
  const activeTab: SeoTab = visibleTabs.includes(tab) ? tab : 'Overview'

  if (toolTabs.length === 0) return <NotContracted label="SEO" />

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  return (
    <div className="space-y-6">
      {/* Tabs (cambian el visual pero no filtran datos) */}
      <Tabs tabs={visibleTabs} active={activeTab} onChange={setTab} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Gráfico 1: Tráfico orgánico */}
      <ChartCard title="Tráfico orgánico — Últimos 30 días">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data.traffic}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="seoGradient" x1="0" y1="0" x2="0" y2="1">
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
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <Tooltip
                content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
                cursor={{ stroke: '#2A2D36' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="sesiones"
                name="Sesiones orgánicas"
                stroke="#F2FE54"
                strokeWidth={2}
                fill="url(#seoGradient)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="clics"
                name="Clics GSC"
                stroke="#FFFFFF"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Fila de 2 gráficos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gráfico 2: Tráfico por canal */}
        <ChartCard title="Tráfico por canal">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.channels}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
                <XAxis
                  dataKey="channel"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#2A2D36' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatCompact(v as number)}
                  width={44}
                />
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" name="Sesiones" radius={[4, 4, 0, 0]}>
                  {data.channels.map((c) => (
                    <Cell
                      key={c.channel}
                      fill={c.organic ? '#F2FE54' : '#6B7280'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Gráfico 3: Evolución posición media (eje invertido) */}
        <ChartCard title="Posición media en Google">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.position}
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
                  reversed
                  domain={[1, 15]}
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatDecimal(v, 1)} />}
                  cursor={{ stroke: '#2A2D36' }}
                />
                <Line
                  type="monotone"
                  dataKey="position"
                  name="Posición media"
                  stroke="#F2FE54"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Tabla 1: Top Queries */}
      <ChartCard title="Top búsquedas en Google" noPadding>
        <DataTable
          columns={gscColumns('Query')}
          data={data.topQueries}
          rowKey={(r) => r.label}
        />
      </ChartCard>

      {/* Tabla 2: Top Páginas */}
      <ChartCard title="Páginas con más tráfico orgánico" noPadding>
        <DataTable
          columns={gscColumns('Página')}
          data={data.topPages}
          rowKey={(r) => r.label}
        />
      </ChartCard>
    </div>
  )
}
