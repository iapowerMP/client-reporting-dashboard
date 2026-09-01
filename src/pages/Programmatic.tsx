import { useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { ImageOff, X } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCompact, formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { computeProgrammaticKpis, type ProgrammaticCampaignRow, type ProgrammaticCreativeRow, type ProgrammaticMediumRow } from '@/data/catalog'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { useParams } from 'react-router-dom'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

/** "PRS_..." -> Prospección, "RTG_..." -> Retargeting, resto sin etiquetar. */
function campaignTypeLabel(name: string): string | null {
  if (/^PRS[_-]/i.test(name)) return 'Prospección'
  if (/^RTG[_-]/i.test(name)) return 'Retargeting'
  return null
}

/** Plantillas de creatividad del kit de Oniad (public/creatives/oniad/),
 * una por formato IAB — no dependen del cliente ni de la campaña, son los
 * mismos 8 tamaños que Oniad entrega para publicidad programática. */
const CREATIVE_PREVIEW_SIZES = new Set([
  '160x600',
  '300x250',
  '300x600',
  '320x50',
  '320x100',
  '320x480',
  '728x90',
  '970x250',
])

function creativePreviewUrl(size: string | null): string | null {
  return size && CREATIVE_PREVIEW_SIZES.has(size) ? `/creatives/oniad/${size}.gif` : null
}

const campaignColumns: Column<ProgrammaticCampaignRow>[] = [
  {
    key: 'name',
    header: 'Campaña',
    sortable: true,
    render: (r) => {
      const type = campaignTypeLabel(r.name)
      return (
        <div>
          <p className="font-medium text-text-primary">{r.name}</p>
          {type && <p className="text-xs text-text-secondary">{type}</p>}
        </div>
      )
    },
  },
  { key: 'impresiones', header: 'Impresiones', align: 'right', sortable: true, render: (r) => formatNumber(r.impresiones) },
  { key: 'clics', header: 'Clics', align: 'right', sortable: true, render: (r) => formatNumber(r.clics) },
  { key: 'ctr', header: 'CTR', align: 'right', sortable: true, render: (r) => formatPercent(r.ctr) },
  { key: 'coste', header: 'Coste', align: 'right', sortable: true, render: (r) => formatCurrency(r.coste, 2) },
  { key: 'cpm', header: 'CPM', align: 'right', sortable: true, render: (r) => formatCurrency(r.cpm, 2) },
]

const mediumColumns: Column<ProgrammaticMediumRow>[] = [
  { key: 'medium', header: 'Sitio', sortable: true },
  { key: 'impresiones', header: 'Impresiones', align: 'right', sortable: true, render: (r) => formatNumber(r.impresiones) },
  { key: 'clics', header: 'Clics', align: 'right', sortable: true, render: (r) => formatNumber(r.clics) },
  { key: 'ctr', header: 'CTR', align: 'right', sortable: true, render: (r) => formatPercent(r.ctr) },
  { key: 'coste', header: 'Coste', align: 'right', sortable: true, render: (r) => formatCurrency(r.coste, 2) },
  { key: 'cpm', header: 'CPM', align: 'right', sortable: true, render: (r) => formatCurrency(r.cpm, 2) },
]

function getCreativeColumns(onPreview: (creative: ProgrammaticCreativeRow) => void): Column<ProgrammaticCreativeRow>[] {
  return [
    { key: 'size', header: 'Formato', sortable: true, render: (r) => r.size ?? '—' },
    {
      key: 'banner',
      header: 'Creatividad',
      sortable: true,
      render: (r) => {
        const preview = creativePreviewUrl(r.size)
        return preview ? (
          <button
            onClick={() => onPreview(r)}
            className="block h-10 w-16 overflow-hidden rounded-control border border-border bg-base transition-opacity hover:opacity-80"
            title="Previsualizar creatividad"
          >
            <img src={preview} alt={r.size ?? r.banner} className="h-full w-full object-contain" />
          </button>
        ) : (
          <div
            className="flex h-10 w-16 items-center justify-center rounded-control border border-border bg-base text-text-secondary"
            title={r.banner}
          >
            <ImageOff className="h-4 w-4" />
          </div>
        )
      },
    },
    { key: 'impresiones', header: 'Impresiones', align: 'right', sortable: true, render: (r) => formatNumber(r.impresiones) },
    { key: 'clics', header: 'Clics', align: 'right', sortable: true, render: (r) => formatNumber(r.clics) },
    { key: 'ctr', header: 'CTR', align: 'right', sortable: true, render: (r) => formatPercent(r.ctr) },
    { key: 'coste', header: 'Coste', align: 'right', sortable: true, render: (r) => formatCurrency(r.coste, 2) },
  ]
}

export default function Programmatic() {
  const { clientSlug = '' } = useParams()
  const { range } = useDateRange()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getProgrammatic(clientSlug, range),
    [clientSlug, range.from, range.to],
  )
  const [previewCreative, setPreviewCreative] = useState<ProgrammaticCreativeRow | null>(null)

  if (loading) return <Loading />
  if (error || !data) return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const kpis = computeProgrammaticKpis(data.summary)
  const creativeColumns = getCreativeColumns(setPreviewCreative)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <ChartCard title="Evolución — Impresiones y clics">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#2A2D36' }}
                interval={2}
              />
              <YAxis
                yAxisId="impresiones"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <YAxis
                yAxisId="clics"
                orientation="right"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
              />
              <Tooltip
                content={<ChartTooltip formatter={(v, name) => (name === 'Impresiones' ? formatNumber(v) : formatNumber(v))} />}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="plainline" />
              <Bar yAxisId="impresiones" dataKey="impresiones" name="Impresiones" fill="#F2FE54" radius={[3, 3, 0, 0]} />
              <Line yAxisId="clics" type="monotone" dataKey="clics" name="Clics" stroke="#60A5FA" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Campañas">
        <DataTable columns={campaignColumns} data={data.campaigns} rowKey={(r) => r.name} />
      </ChartCard>

      <ChartCard title={`Sitios con más impresiones${data.mediumsOmitted > 0 ? ` (top ${data.mediums.length})` : ''}`}>
        <DataTable columns={mediumColumns} data={data.mediums} rowKey={(r) => r.medium} />
        {data.mediumsOmitted > 0 && (
          <p className="mt-3 text-xs text-text-secondary">
            Y {formatNumber(data.mediumsOmitted)} sitios más con menos impresiones, no mostrados aquí.
          </p>
        )}
      </ChartCard>

      <ChartCard title="Creatividades">
        <DataTable columns={creativeColumns} data={data.creatives} rowKey={(r) => r.banner} />
      </ChartCard>

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
                <p className="text-sm font-semibold text-white">{previewCreative.size ?? 'Creatividad'}</p>
                <p className="break-all text-xs text-text-secondary">{previewCreative.banner}</p>
              </div>
              <button
                onClick={() => setPreviewCreative(null)}
                className="rounded-control p-1 text-text-secondary hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {creativePreviewUrl(previewCreative.size) && (
              <img
                src={creativePreviewUrl(previewCreative.size)!}
                alt={previewCreative.size ?? previewCreative.banner}
                className="w-full rounded-control bg-base"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
