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
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCompact, formatCurrency, formatNumber } from '@/lib/utils'
import { computeNegocioKpis, type CampaignCpaRow, type AdCpaRow } from '@/data/catalog'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { useParams } from 'react-router-dom'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

const campaignColumns: Column<CampaignCpaRow>[] = [
  {
    key: 'campaign',
    header: 'Campaña (UTM)',
    sortable: true,
    render: (r) => (
      <div>
        <p className="font-medium text-text-primary">{r.campaign}</p>
        {!r.platform && <p className="text-xs text-text-secondary">Sin campaña de pago asociada</p>}
      </div>
    ),
  },
  { key: 'platform', header: 'Plataforma', sortable: true, render: (r) => r.platform ?? '—' },
  { key: 'inversion', header: 'Inversión', align: 'right', sortable: true, render: (r) => formatCurrency(r.inversion, 2) },
  { key: 'contactos', header: 'Contactos', align: 'right', sortable: true, render: (r) => formatNumber(r.contactos) },
  { key: 'cpa', header: 'CPA', align: 'right', sortable: true, render: (r) => (r.cpa === null ? '—' : formatCurrency(r.cpa, 2)) },
  { key: 'deals', header: 'Deals', align: 'right', sortable: true, render: (r) => formatNumber(r.deals) },
  { key: 'dealsGanados', header: 'Ganados', align: 'right', sortable: true, render: (r) => formatNumber(r.dealsGanados) },
  { key: 'importeGanado', header: 'Importe ganado', align: 'right', sortable: true, render: (r) => formatCurrency(r.importeGanado, 2) },
]

const adColumns: Column<AdCpaRow>[] = [
  {
    key: 'thumbnail',
    header: '',
    render: (r) =>
      r.thumbnailUrl ? (
        <img src={r.thumbnailUrl} alt={r.adName} className="h-10 w-10 rounded-control border border-border object-cover" />
      ) : (
        <div className="h-10 w-10 rounded-control border border-border bg-base" />
      ),
  },
  { key: 'adName', header: 'Anuncio', sortable: true },
  { key: 'inversion', header: 'Inversión', align: 'right', sortable: true, render: (r) => formatCurrency(r.inversion, 2) },
  { key: 'contactos', header: 'Contactos', align: 'right', sortable: true, render: (r) => formatNumber(r.contactos) },
  { key: 'cpa', header: 'CPA', align: 'right', sortable: true, render: (r) => (r.cpa === null ? '—' : formatCurrency(r.cpa, 2)) },
  { key: 'deals', header: 'Deals', align: 'right', sortable: true, render: (r) => formatNumber(r.deals) },
  { key: 'dealsGanados', header: 'Ganados', align: 'right', sortable: true, render: (r) => formatNumber(r.dealsGanados) },
  { key: 'importeGanado', header: 'Importe ganado', align: 'right', sortable: true, render: (r) => formatCurrency(r.importeGanado, 2) },
]

export default function Negocio() {
  const { clientSlug = '' } = useParams()
  const { range } = useDateRange()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getNegocio(clientSlug, range),
    [clientSlug, range.from, range.to],
  )

  if (loading) return <Loading />
  if (error || !data) return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const kpis = computeNegocioKpis(data)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <ChartCard title="Pipeline por etapa">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.pipeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
              <XAxis dataKey="stage" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={{ stroke: '#2A2D36' }} />
              <YAxis
                yAxisId="amount"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={52}
              />
              <YAxis yAxisId="count" orientation="right" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} width={36} />
              <Tooltip
                content={
                  <ChartTooltip formatter={(v, name) => (name === 'Importe' ? formatCurrency(v, 2) : formatNumber(v))} />
                }
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="plainline" />
              <Bar yAxisId="amount" dataKey="amount" name="Importe" fill="#F2FE54" radius={[3, 3, 0, 0]} />
              <Line yAxisId="count" type="monotone" dataKey="count" name="Deals" stroke="#60A5FA" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Coste por adquisición por campaña">
        <DataTable columns={campaignColumns} data={data.byCampaign} rowKey={(r) => `${r.campaign}::${r.platform ?? 'none'}`} />
      </ChartCard>

      <ChartCard title="Coste por adquisición por anuncio (Meta Ads)">
        <DataTable columns={adColumns} data={data.byAd} rowKey={(r) => r.adId} />
      </ChartCard>
    </div>
  )
}
