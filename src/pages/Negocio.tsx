import ChartCard from '@/components/shared/ChartCard'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/utils'
import { computeNegocioKpis, type CampaignCpaRow, type AdCpaRow } from '@/data/catalog'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { useParams, Link } from 'react-router-dom'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { Link as LinkIcon } from 'lucide-react'

const acquisitionColumns = <R extends { inversion: number; clicks: number; leads: number; tasaConversion: number | null; oportunidades: number; costePorOportunidad: number | null; adquisiciones: number; costePorAdquisicion: number | null; roas: number | null }>(): Column<R>[] => [
  { key: 'inversion' as const, header: 'Inversión', align: 'right', sortable: true, render: (r) => formatCurrency(r.inversion, 2) },
  { key: 'clicks' as const, header: 'Clics', align: 'right', sortable: true, render: (r) => formatNumber(r.clicks) },
  { key: 'leads' as const, header: 'Leads', align: 'right', sortable: true, render: (r) => formatNumber(r.leads) },
  {
    key: 'tasaConversion' as const,
    header: 'Tasa conversión',
    align: 'right',
    sortable: true,
    render: (r) => (r.tasaConversion === null ? '—' : formatPercent(r.tasaConversion)),
  },
  { key: 'oportunidades' as const, header: 'Oportunidades', align: 'right', sortable: true, render: (r) => formatNumber(r.oportunidades) },
  {
    key: 'costePorOportunidad' as const,
    header: 'Coste/oportunidad',
    align: 'right',
    sortable: true,
    render: (r) => (r.costePorOportunidad === null ? '—' : formatCurrency(r.costePorOportunidad, 2)),
  },
  { key: 'adquisiciones' as const, header: 'Adquisiciones', align: 'right', sortable: true, render: (r) => formatNumber(r.adquisiciones) },
  {
    key: 'costePorAdquisicion' as const,
    header: 'Coste/adquisición',
    align: 'right',
    sortable: true,
    render: (r) => (r.costePorAdquisicion === null ? '—' : formatCurrency(r.costePorAdquisicion, 2)),
  },
  { key: 'roas' as const, header: 'ROAS', align: 'right', sortable: true, render: (r) => (r.roas === null ? '—' : formatRoas(r.roas)) },
]

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
  ...acquisitionColumns<CampaignCpaRow>(),
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
  ...acquisitionColumns<AdCpaRow>(),
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
  if (!data.connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <LinkIcon className="h-6 w-6 text-text-secondary" />
        <p className="max-w-md text-sm text-text-secondary">
          Este cliente no tiene HubSpot conectado todavía. Conéctalo desde{' '}
          <Link to={`/${clientSlug}/settings`} className="text-accent underline">
            Configuración
          </Link>{' '}
          para ver el pipeline de ventas y el coste por adquisición.
        </p>
      </div>
    )
  }

  const kpis = computeNegocioKpis(data)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <ChartCard title="Pipeline por etapa" noPadding>
        <div className="flex gap-3 overflow-x-auto p-4">
          {data.pipeline.map((stage) => (
            <div key={stage.stage} className="w-64 shrink-0 rounded-control border border-border bg-base">
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-text-primary" title={stage.stage}>
                  {stage.stage}
                </p>
                <p className="text-xs text-text-secondary">
                  {formatNumber(stage.count)} · {formatCurrency(stage.amount, 0)}
                </p>
              </div>
              <div className="max-h-96 space-y-1.5 overflow-y-auto p-2">
                {stage.deals.length === 0 && <p className="px-1 py-2 text-xs text-text-secondary">Sin negocios</p>}
                {stage.deals.map((deal) => (
                  <div key={deal.dealId} className="rounded-control border border-border bg-card px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-text-primary" title={deal.company}>
                      {deal.company}
                    </p>
                    <p className="text-xs text-text-secondary">{formatCurrency(deal.amount, 0)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Coste por oportunidad y adquisición por campaña">
        <DataTable columns={campaignColumns} data={data.byCampaign} rowKey={(r) => `${r.campaign}::${r.platform ?? 'none'}`} />
      </ChartCard>

      <ChartCard title="Coste por oportunidad y adquisición por anuncio (Meta Ads)">
        <DataTable columns={adColumns} data={data.byAd} rowKey={(r) => r.adId} />
      </ChartCard>
    </div>
  )
}
