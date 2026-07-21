import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { ExternalLink, ImageOff, X } from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  LineChart,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts'
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import Tabs from '@/components/shared/Tabs'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PlatformBadge from '@/components/shared/PlatformBadge'
import StatusBadge from '@/components/shared/StatusBadge'
import {
  cn,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRoas,
} from '@/lib/utils'
import {
  type PaidTab,
  type BusinessType,
  type Campaign,
  type MetaCreative,
  PAID_PLATFORMS,
  PAID_TAB_TO_CONNECTION,
  computePaidKpis,
  computePaidDeltas,
  computeFunnel,
  computeCampaignEfficiencySeries,
  computePlatformShareData,
} from '@/data/catalog'
import { useReportConfig } from '@/lib/reportConfig'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange, getPreviousRange, type DateRange } from '@/lib/dateRange'
import { type useClientInfo } from '@/lib/useClientInfo'
import type { PaidData } from '@/services/types'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import NotContracted from '@/components/shared/NotContracted'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Colores por plataforma, reutilizados en barras apiladas. */
const PLATFORM_COLORS: Record<string, string> = {
  'Google Ads': '#34A853',
  'Meta Ads': '#1877F2',
  'TikTok Ads': '#EE1D52',
}

/** Paleta para las líneas del gráfico "Eficiencia por campaña" — se cicla
 * por índice, una por campaña. */
const CAMPAIGN_LINE_COLORS = [
  '#F2FE54',
  '#60A5FA',
  '#F87171',
  '#34D399',
  '#A78BFA',
  '#FB923C',
  '#22D3EE',
  '#F472B6',
]

/** Etiqueta de "conversiones" según el tipo de negocio del cliente: leads
 * para leadgen, ventas para ecommerce, genérica si no está definido. */
function conversionLabel(businessType: BusinessType): string {
  if (businessType === 'leadgen') return 'Leads'
  if (businessType === 'ecommerce') return 'Ventas'
  return 'Conversiones'
}

/** Etiqueta de la métrica de eficiencia (línea del combo chart / eje Y del scatter). */
function efficiencyLabel(businessType: BusinessType): string {
  if (businessType === 'leadgen') return 'CPL'
  if (businessType === 'ecommerce') return 'ROAS'
  return 'Coste/Conv'
}

/** KPI a resaltar en las cards, según el tipo de negocio. */
function highlightLabel(businessType: BusinessType): string {
  if (businessType === 'leadgen') return 'Leads'
  if (businessType === 'ecommerce') return 'ROAS'
  return 'Conversiones'
}

function formatResult(businessType: BusinessType, v: number): string {
  return businessType === 'ecommerce' ? formatCurrency(v) : formatNumber(v)
}

function formatEfficiency(businessType: BusinessType, v: number): string {
  return businessType === 'ecommerce' ? formatRoas(v, 1) : formatCurrency(v, 2)
}

/** Ancho (%) de cada escalón del funnel visual. Usa raíz cuadrada (en vez de
 * lineal) para que los últimos pasos, normalmente muy pequeños frente a
 * impresiones, sigan siendo legibles — con un mínimo y estrictamente
 * decreciente entre escalones consecutivos. */
function computeFunnelWidths(steps: { value: number }[]): number[] {
  const max = steps[0]?.value || 0
  const widths: number[] = []
  steps.forEach((s, i) => {
    const raw = max ? Math.sqrt(s.value / max) * 100 : 0
    let w = Math.max(raw, 20)
    if (i > 0) w = Math.min(w, widths[i - 1] - 10)
    widths.push(Math.max(w, 20))
  })
  return widths
}

/** Cuenta los días del rango (inclusive), para prorratear objetivos mensuales. */
function daysInRange(range: DateRange): number {
  const start = new Date(range.from)
  const end = new Date(range.to)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

function getCampaignColumns(businessType: BusinessType, target: number | null): Column<Campaign>[] {
  const base: Column<Campaign>[] = [
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
      header: conversionLabel(businessType) === 'Conversiones' ? 'Conv.' : conversionLabel(businessType),
      align: 'right',
      sortable: true,
      render: (r) => formatNumber(r.conversiones),
    },
  ]

  if (businessType === 'leadgen') {
    return [
      ...base,
      {
        key: 'tasaConversion',
        header: 'Tasa conversión',
        align: 'right',
        sortable: true,
        accessor: (r) => (r.clics ? (r.conversiones / r.clics) * 100 : 0),
        render: (r) => formatPercent(r.clics ? (r.conversiones / r.clics) * 100 : 0),
      },
      {
        key: 'cpl',
        header: 'CPL',
        align: 'right',
        sortable: true,
        accessor: (r) => (r.conversiones ? r.inversion / r.conversiones : 0),
        render: (r) => {
          const cpl = r.conversiones ? r.inversion / r.conversiones : 0
          const good = target == null ? null : cpl <= target
          return (
            <span className={good === null ? '' : cn(good ? 'text-positive' : 'text-negative', 'font-semibold')}>
              {formatCurrency(cpl, 2)}
            </span>
          )
        },
      },
    ]
  }

  if (businessType === 'ecommerce') {
    return [
      ...base,
      {
        key: 'ingresos',
        header: 'Ingresos',
        align: 'right',
        sortable: true,
        accessor: (r) => r.roas * r.inversion,
        render: (r) => formatCurrency(r.roas * r.inversion),
      },
      {
        key: 'roas',
        header: 'ROAS',
        align: 'right',
        sortable: true,
        render: (r) => {
          const good = target == null ? null : r.roas >= target
          return (
            <span className={good === null ? '' : cn(good ? 'text-positive' : 'text-negative', 'font-semibold')}>
              {formatRoas(r.roas, 1)}
            </span>
          )
        },
      },
    ]
  }

  return base
}

function getCreativeColumns(
  businessType: BusinessType,
  metaAdAccountId: string | null,
  onPreview: (creative: MetaCreative) => void,
): Column<MetaCreative>[] {
  return [
    {
      key: 'thumbnail',
      header: '',
      render: (r) =>
        r.thumbnailUrl ? (
          <button
            onClick={() => onPreview(r)}
            className="block h-10 w-10 overflow-hidden rounded-control border border-border transition-opacity hover:opacity-80"
            title="Previsualizar anuncio"
          >
            <img src={r.thumbnailUrl} alt={r.name} className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-control border border-border bg-base text-text-secondary">
            <ImageOff className="h-4 w-4" />
          </div>
        ),
    },
    { key: 'name', header: 'Anuncio', sortable: true },
    { key: 'format', header: 'Formato', sortable: true },
    { key: 'impresiones', header: 'Impresiones', align: 'right', sortable: true, render: (r) => formatNumber(r.impresiones) },
    { key: 'ctr', header: 'CTR', align: 'right', sortable: true, render: (r) => formatPercent(r.ctr) },
    {
      key: 'conversiones',
      header: conversionLabel(businessType) === 'Conversiones' ? 'Conv.' : conversionLabel(businessType),
      align: 'right',
      sortable: true,
      render: (r) => formatNumber(r.conversiones),
    },
    {
      key: businessType === 'ecommerce' ? 'roas' : 'costeConv',
      header: businessType === 'ecommerce' ? 'ROAS' : 'CPL',
      align: 'right',
      sortable: true,
      render: (r) => (businessType === 'ecommerce' ? formatRoas(r.roas, 1) : formatCurrency(r.costeConv, 2)),
    },
    { key: 'frecuencia', header: 'Frecuencia', align: 'right', sortable: true, render: (r) => r.frecuencia.toFixed(2) },
    {
      key: 'ver',
      header: '',
      align: 'center',
      render: (r) =>
        metaAdAccountId ? (
          <a
            href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAdAccountId}&selected_ad_ids=${r.adId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            title="Ver anuncio en Meta Ads Manager"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null,
    },
  ]
}

/** Badge tipo semáforo: compara un valor puntual (CPL/ROAS) contra un target. */
function TargetBadge({
  label,
  actual,
  target,
  format,
  goodWhen,
}: {
  label: string
  actual: number
  target: number
  format: (n: number) => string
  goodWhen: 'lower' | 'higher'
}) {
  const good = goodWhen === 'lower' ? actual <= target : actual >= target
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-card p-4">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', good ? 'bg-positive' : 'bg-negative')} />
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-sm font-semibold text-text-primary">
          {format(actual)} <span className="font-normal text-text-secondary">/ target {format(target)}</span>
        </p>
      </div>
    </div>
  )
}

/** Barra de progreso: volumen (leads/revenue) acumulado vs. objetivo prorrateado. */
function TargetProgress({
  label,
  actual,
  target,
  format,
}: {
  label: string
  actual: number
  target: number
  format: (n: number) => string
}) {
  const pct = target ? Math.min(100, (actual / target) * 100) : 0
  const reached = target ? actual >= target : false
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-xs font-semibold text-text-primary">
          {format(actual)} / {format(target)}
        </p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-base">
        <div
          className={cn('h-full rounded-full', reached ? 'bg-positive' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

interface ComboRow {
  date: string
  eficiencia: number
  [platform: string]: number | string
}

/** Construye los datos del combo chart: barras = leads/ingresos por día
 * (apiladas por plataforma en "Todas", una sola serie en pestaña de
 * plataforma), línea = CPL/ROAS combinado del rango. */
function buildComboData(
  invConv: { date: string; inversion: number; conversiones: number; ingresos: number }[],
  invConvByPlatform: Record<string, { date: string; inversion: number; conversiones: number; ingresos: number }[]>,
  activeTab: PaidTab,
  visiblePlatforms: string[],
  businessType: BusinessType,
): ComboRow[] {
  const efficiencyOf = (inversion: number, conversiones: number, ingresos: number) =>
    businessType === 'ecommerce' ? (inversion ? round2(ingresos / inversion) : 0) : conversiones ? round2(inversion / conversiones) : 0
  const resultOf = (p: { conversiones: number; ingresos: number }) => (businessType === 'ecommerce' ? p.ingresos : p.conversiones)

  if (activeTab === 'Todas') {
    const platformMaps = visiblePlatforms.map(
      (platform) => [platform, new Map((invConvByPlatform[platform] ?? []).map((x) => [x.date, x]))] as const,
    )
    return invConv.map((p) => {
      const row: ComboRow = { date: p.date, eficiencia: efficiencyOf(p.inversion, p.conversiones, p.ingresos) }
      for (const [platform, m] of platformMaps) {
        const match = m.get(p.date)
        row[platform] = match ? resultOf(match) : 0
      }
      return row
    })
  }

  const series = invConvByPlatform[activeTab] ?? []
  return series.map((p) => ({
    date: p.date,
    [activeTab]: resultOf(p),
    eficiencia: efficiencyOf(p.inversion, p.conversiones, p.ingresos),
  }))
}

export default function PaidMedia() {
  const { clientSlug = '' } = useParams()
  const { isVisible } = useReportConfig()
  const { range, label: rangeLabel } = useDateRange()
  const clientInfo = useOutletContext<ReturnType<typeof useClientInfo>>()
  const businessType = clientInfo.data?.businessType ?? null
  const cplTarget = clientInfo.data?.cplTarget ?? null
  const leadsTargetMonthly = clientInfo.data?.leadsTargetMonthly ?? null
  const roasTarget = clientInfo.data?.roasTarget ?? null
  const revenueTargetMonthly = clientInfo.data?.revenueTargetMonthly ?? null

  const { data, loading, error } = useAsyncData(
    () => getProvider().getPaid(clientSlug, range),
    [clientSlug, range.from, range.to],
  )
  // Periodo anterior (misma duración) solo para calcular la variación % de
  // los KPIs — si tarda o falla, los KPIs simplemente se muestran sin delta
  // en vez de bloquear la vista principal.
  const previousRange = getPreviousRange(range)
  const { data: prevData } = useAsyncData(
    () => getProvider().getPaid(clientSlug, previousRange),
    [clientSlug, previousRange.from, previousRange.to],
  )

  // Solo se muestran las plataformas activadas en Configuración.
  const platformTabs = PAID_PLATFORMS.filter((p) =>
    isVisible(PAID_TAB_TO_CONNECTION[p]),
  )
  const visibleTabs: PaidTab[] = ['Todas', ...platformTabs]

  if (platformTabs.length === 0) return <NotContracted label="Paid Media" />

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  return (
    <PaidMediaTabs
      data={data}
      prevData={prevData}
      platformTabs={platformTabs}
      visibleTabs={visibleTabs}
      businessType={businessType}
      cplTarget={cplTarget}
      leadsTargetMonthly={leadsTargetMonthly}
      roasTarget={roasTarget}
      revenueTargetMonthly={revenueTargetMonthly}
      range={range}
      rangeLabel={rangeLabel}
    />
  )
}

function PaidMediaTabs({
  data,
  prevData,
  platformTabs,
  visibleTabs,
  businessType,
  cplTarget,
  leadsTargetMonthly,
  roasTarget,
  revenueTargetMonthly,
  range,
  rangeLabel,
}: {
  data: PaidData
  prevData: PaidData | null
  platformTabs: readonly PaidTab[]
  visibleTabs: PaidTab[]
  businessType: BusinessType
  cplTarget: number | null
  leadsTargetMonthly: number | null
  roasTarget: number | null
  revenueTargetMonthly: number | null
  range: DateRange
  rangeLabel: string
}) {
  const [tab, setTab] = useState<PaidTab>('Todas')
  const activeTab: PaidTab = visibleTabs.includes(tab) ? tab : 'Todas'
  const [previewCreative, setPreviewCreative] = useState<MetaCreative | null>(null)
  const visiblePlatforms: string[] = [...platformTabs]

  const rows =
    activeTab === 'Todas'
      ? data.campaigns.filter((c) => visiblePlatforms.includes(c.platform))
      : data.campaigns.filter((c) => c.platform === activeTab)

  const rawKpis = computePaidKpis(activeTab, visiblePlatforms, data.campaigns, businessType)
  const deltas = computePaidDeltas(activeTab, visiblePlatforms, data.campaigns, prevData?.campaigns ?? [], businessType)
  const kpis = rawKpis.map((k) => ({ ...k, ...(deltas[k.label] ?? {}) }))

  const target = businessType === 'ecommerce' ? roasTarget : businessType === 'leadgen' ? cplTarget : null
  const campaignColumns = getCampaignColumns(businessType, target)

  const days = daysInRange(range)
  const proratedLeadsTarget = leadsTargetMonthly != null ? round2((leadsTargetMonthly * days) / 30) : null
  const proratedRevenueTarget = revenueTargetMonthly != null ? round2((revenueTargetMonthly * days) / 30) : null

  const comboData = buildComboData(data.invConv, data.invConvByPlatform, activeTab, visiblePlatforms, businessType)
  const comboTitle =
    activeTab === 'Todas'
      ? `${conversionLabel(businessType)} vs ${efficiencyLabel(businessType)} por plataforma — ${rangeLabel}`
      : `${conversionLabel(businessType)} vs ${efficiencyLabel(businessType)} — ${activeTab} — ${rangeLabel}`

  const platformShareData = computePlatformShareData(rows, visiblePlatforms, businessType)
  const funnel = computeFunnel(rows, businessType)
  const funnelWidths = computeFunnelWidths(funnel.steps)
  const campaignDailyForTab = data.campaignDaily.filter((r) => r.platform === activeTab)
  const campaignEfficiency = computeCampaignEfficiencySeries(campaignDailyForTab, businessType)

  const creativeColumns = getCreativeColumns(businessType, data.metaAdAccountId, setPreviewCreative)
  const sortedCreatives = [...data.metaCreatives].sort((a, b) =>
    businessType === 'ecommerce' ? b.roas - a.roas : a.costeConv - b.costeConv,
  )

  return (
    <div className="space-y-6">
      {/* Tabs de plataforma */}
      <Tabs tabs={visibleTabs} active={activeTab} onChange={setTab} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} highlight={kpi.label === highlightLabel(businessType)} />
        ))}
      </div>

      {/* Semáforos de target — solo en "Todas" y solo si hay target definido */}
      {activeTab === 'Todas' && businessType === 'leadgen' && (cplTarget != null || proratedLeadsTarget != null) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cplTarget != null && (
            <TargetBadge
              label="CPL vs. target"
              actual={(() => {
                const inv = rows.reduce((s, r) => s + r.inversion, 0)
                const conv = rows.reduce((s, r) => s + r.conversiones, 0)
                return conv ? round2(inv / conv) : 0
              })()}
              target={cplTarget}
              format={(n) => formatCurrency(n, 2)}
              goodWhen="lower"
            />
          )}
          {proratedLeadsTarget != null && (
            <TargetProgress
              label={`Leads vs. objetivo (${days}d, prorrateado de ${leadsTargetMonthly}/mes)`}
              actual={rows.reduce((s, r) => s + r.conversiones, 0)}
              target={proratedLeadsTarget}
              format={(n) => formatNumber(n)}
            />
          )}
        </div>
      )}
      {activeTab === 'Todas' && businessType === 'ecommerce' && (roasTarget != null || proratedRevenueTarget != null) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {roasTarget != null && (
            <TargetBadge
              label="ROAS vs. target"
              actual={(() => {
                const inv = rows.reduce((s, r) => s + r.inversion, 0)
                const ing = rows.reduce((s, r) => s + r.roas * r.inversion, 0)
                return inv ? round2(ing / inv) : 0
              })()}
              target={roasTarget}
              format={(n) => formatRoas(n, 1)}
              goodWhen="higher"
            />
          )}
          {proratedRevenueTarget != null && (
            <TargetProgress
              label={`Revenue vs. objetivo (${days}d, prorrateado de ${formatCurrency(revenueTargetMonthly ?? 0)}/mes)`}
              actual={rows.reduce((s, r) => s + r.roas * r.inversion, 0)}
              target={proratedRevenueTarget}
              format={(n) => formatCurrency(n)}
            />
          )}
        </div>
      )}

      {/* Combo chart: resultado por día (+ plataforma en "Todas") + eficiencia */}
      <ChartCard title={comboTitle}>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={comboData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                width={48}
                tickFormatter={(v) => formatEfficiency(businessType, v as number)}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(v, name) =>
                      name === efficiencyLabel(businessType) ? formatEfficiency(businessType, v) : formatResult(businessType, v)
                    }
                  />
                }
                cursor={{ stroke: '#2A2D36' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
              {activeTab === 'Todas' ? (
                visiblePlatforms.map((platform) => (
                  <Bar
                    key={platform}
                    yAxisId="left"
                    dataKey={platform}
                    name={platform}
                    stackId="result"
                    fill={PLATFORM_COLORS[platform] ?? '#F2FE54'}
                    radius={[2, 2, 0, 0]}
                  />
                ))
              ) : (
                <Bar
                  yAxisId="left"
                  dataKey={activeTab}
                  name={conversionLabel(businessType)}
                  fill={PLATFORM_COLORS[activeTab] ?? '#F2FE54'}
                  radius={[2, 2, 0, 0]}
                />
              )}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="eficiencia"
                name={efficiencyLabel(businessType)}
                stroke="#FFFFFF"
                strokeWidth={2}
                dot={{ r: 2, fill: '#FFFFFF' }}
              />
              {target != null && (
                <ReferenceLine
                  yAxisId="right"
                  y={target}
                  stroke="#F2FE54"
                  strokeDasharray="4 4"
                  label={{ value: `Target ${formatEfficiency(businessType, target)}`, fill: '#F2FE54', fontSize: 11, position: 'insideTopRight' }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {activeTab === 'Todas' ? (
        <>
          {/* Comparativa plataformas: % gasto vs. % resultado */}
          {visiblePlatforms.length > 1 && (
            <ChartCard title="Comparativa plataformas — gasto vs. resultado">
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={platformShareData}
                    layout="vertical"
                    stackOffset="expand"
                    margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="#9CA3AF"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#2A2D36' }}
                      tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
                    />
                    <YAxis type="category" dataKey="metric" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} width={80} />
                    <Tooltip
                      content={<ChartTooltip formatter={(v, name) => (name === conversionLabel(businessType) ? formatResult(businessType, v) : formatCurrency(v))} />}
                      cursor={{ fill: '#ffffff08' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {visiblePlatforms.map((platform) => (
                      <Bar key={platform} dataKey={platform} name={platform} stackId="share" fill={PLATFORM_COLORS[platform] ?? '#F2FE54'} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {/* Funnel simplificado: Impresiones → Clics → Leads/Ventas */}
          <ChartCard title={`Funnel — Impresiones → Clics → ${conversionLabel(businessType)}`}>
            <div className="mx-auto flex max-w-md flex-col items-center">
              {funnel.steps.map((step, i) => {
                const top = funnelWidths[i]
                const bottom = i < funnelWidths.length - 1 ? funnelWidths[i + 1] : Math.max(top - 10, 20)
                const insetTop = (100 - top) / 2
                const insetBottom = (100 - bottom) / 2
                return (
                  <div key={step.label} className="w-full">
                    <div className="relative h-16 w-full">
                      <div
                        className="absolute inset-0 bg-accent"
                        style={{
                          clipPath: `polygon(${insetTop}% 0%, ${100 - insetTop}% 0%, ${100 - insetBottom}% 100%, ${insetBottom}% 100%)`,
                        }}
                      />
                      <div className="relative flex h-full flex-col items-center justify-center text-center">
                        <p className="text-xs font-medium text-base">{step.label}</p>
                        <p className="text-lg font-bold text-base">{step.displayValue}</p>
                      </div>
                    </div>
                    {i < funnel.transitions.length && (
                      <div className="flex flex-col items-center gap-0.5 py-2 text-xs">
                        <span className="text-text-secondary">▼</span>
                        <span className="font-semibold text-accent">{funnel.transitions[i].label}</span>
                        <span className="text-text-secondary">{funnel.transitions[i].value}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </ChartCard>
        </>
      ) : (
        /* Eficiencia por campaña a lo largo del tiempo: una línea por campaña (solo pestañas de plataforma) */
        <ChartCard title={`${efficiencyLabel(businessType)} por campaña — ${activeTab}`}>
          {campaignEfficiency.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">Aún no hay datos suficientes.</p>
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={campaignEfficiency.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                      stroke="#9CA3AF"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatEfficiency(businessType, v as number)}
                      width={52}
                    />
                    <Tooltip
                      content={<ChartTooltip formatter={(v) => formatEfficiency(businessType, v)} />}
                      cursor={{ stroke: '#2A2D36' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="plainline" />
                    {campaignEfficiency.campaigns.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        name={name}
                        stroke={CAMPAIGN_LINE_COLORS[i % CAMPAIGN_LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {campaignEfficiency.omitted > 0 && (
                <p className="mt-2 text-xs text-text-secondary">
                  Mostrando las {campaignEfficiency.campaigns.length} campañas con más inversión — {campaignEfficiency.omitted} más no se muestran para no saturar el gráfico.
                </p>
              )}
            </>
          )}
        </ChartCard>
      )}

      {/* Tabla de campañas */}
      <ChartCard title="Detalle de campañas" noPadding>
        <DataTable
          columns={campaignColumns}
          data={rows}
          rowKey={(r) => `${r.platform}-${r.name}`}
        />
      </ChartCard>

      {/* Creatividades Meta (nivel anuncio) — solo pestaña Meta Ads */}
      {activeTab === 'Meta Ads' && (
        <ChartCard title="Creatividades" noPadding>
          {sortedCreatives.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">
              Aún no hay datos de creatividades de Meta Ads.
            </p>
          ) : (
            <DataTable columns={creativeColumns} data={sortedCreatives} rowKey={(r) => r.adId} />
          )}
        </ChartCard>
      )}

      {previewCreative && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewCreative(null)}
        >
          <div
            className="max-w-sm rounded-card border border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">{previewCreative.name}</p>
                <p className="text-xs text-text-secondary">{previewCreative.format}</p>
              </div>
              <button
                onClick={() => setPreviewCreative(null)}
                className="rounded-control p-1 text-text-secondary hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {previewCreative.thumbnailUrl && (
              <img
                src={previewCreative.thumbnailUrl}
                alt={previewCreative.name}
                className="w-full rounded-control"
              />
            )}
            {previewCreative.format === 'video' && (
              <p className="mt-2 text-xs text-text-secondary">
                Vista previa estática (fotograma) — el vídeo completo solo puede verse en Meta Ads Manager.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
