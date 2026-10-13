import ChartCard from '@/components/shared/ChartCard'
import KpiCard from '@/components/shared/KpiCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/utils'
import { computeNegocioKpis, formatChannelLabel, type ChannelCpaRow, type CampaignCpaRow, type AdCpaRow } from '@/data/catalog'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { useParams, Link } from 'react-router-dom'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { Link as LinkIcon } from 'lucide-react'
import InfoTooltip from '@/components/shared/InfoTooltip'

const acquisitionColumns = <R extends { inversion: number; clicks: number; leads: number; tasaConversion: number | null; oportunidades: number; costePorOportunidad: number | null; adquisiciones: number; costePorAdquisicion: number | null; roas: number | null }>(): Column<R>[] => [
  {
    key: 'inversion' as const,
    header: 'Inversión',
    align: 'right',
    sortable: true,
    description: 'Gasto real en Google Ads/Meta Ads durante el rango de fechas seleccionado.',
    render: (r) => formatCurrency(r.inversion, 2),
  },
  {
    key: 'clicks' as const,
    header: 'Clics',
    align: 'right',
    sortable: true,
    description: 'Clics en los anuncios durante el rango de fechas seleccionado.',
    render: (r) => formatNumber(r.clicks),
  },
  {
    key: 'leads' as const,
    header: 'Leads',
    align: 'right',
    sortable: true,
    description: 'Contactos de HubSpot creados en el rango seleccionado, atribuidos por su UTM.',
    render: (r) => formatNumber(r.leads),
  },
  {
    key: 'tasaConversion' as const,
    header: 'Tasa conversión',
    align: 'right',
    sortable: true,
    description: 'Leads ÷ Clics × 100.',
    render: (r) => (r.tasaConversion === null ? '—' : formatPercent(r.tasaConversion)),
  },
  {
    key: 'oportunidades' as const,
    header: 'Oportunidades',
    align: 'right',
    sortable: true,
    description: 'Negocios creados en el rango seleccionado, atribuidos a través del contacto principal.',
    render: (r) => formatNumber(r.oportunidades),
  },
  {
    key: 'costePorOportunidad' as const,
    header: 'Coste/oportunidad',
    align: 'right',
    sortable: true,
    description: 'Inversión ÷ Oportunidades: cuánto cuesta de media generar un negocio nuevo en el pipeline.',
    render: (r) => (r.costePorOportunidad === null ? '—' : formatCurrency(r.costePorOportunidad, 2)),
  },
  {
    key: 'adquisiciones' as const,
    header: 'Adquisiciones',
    align: 'right',
    sortable: true,
    description: 'Negocios ganados cuya fecha de cierre cae en el rango seleccionado.',
    render: (r) => formatNumber(r.adquisiciones),
  },
  {
    key: 'costePorAdquisicion' as const,
    header: 'Coste/adquisición',
    align: 'right',
    sortable: true,
    description: 'Inversión ÷ Adquisiciones: cuánto cuesta de media ganar un cliente (CAC).',
    render: (r) => (r.costePorAdquisicion === null ? '—' : formatCurrency(r.costePorAdquisicion, 2)),
  },
  {
    key: 'roas' as const,
    header: 'ROAS',
    align: 'right',
    sortable: true,
    description: 'Importe ganado de las adquisiciones del periodo ÷ Inversión: € de negocio cerrado por cada € invertido.',
    render: (r) => (r.roas === null ? '—' : formatRoas(r.roas)),
  },
]

const channelColumns: Column<ChannelCpaRow>[] = [
  {
    key: 'channel',
    header: 'Canal',
    sortable: true,
    description: 'Fuente original de tráfico del contacto en HubSpot (orgánico, redes de pago, directo, referidos...), no solo campañas de pago.',
    render: (r) => formatChannelLabel(r.channel),
  },
  {
    key: 'contactos',
    header: 'Contactos',
    align: 'right',
    sortable: true,
    description: 'Contactos de HubSpot creados en el rango seleccionado con este canal como fuente original.',
    render: (r) => formatNumber(r.contactos),
  },
  {
    key: 'oportunidades',
    header: 'Oportunidades',
    align: 'right',
    sortable: true,
    description: 'Negocios creados en el rango seleccionado, atribuidos a través del contacto principal.',
    render: (r) => formatNumber(r.oportunidades),
  },
  {
    key: 'adquisiciones',
    header: 'Adquisiciones',
    align: 'right',
    sortable: true,
    description: 'Negocios ganados cuya fecha de cierre cae en el rango seleccionado.',
    render: (r) => formatNumber(r.adquisiciones),
  },
  {
    key: 'tasaCierre',
    header: 'Tasa de cierre',
    align: 'right',
    sortable: true,
    description: 'Adquisiciones ÷ (adquisiciones + perdidos) × 100, ambos con fecha de cierre en el rango seleccionado.',
    render: (r) => (r.tasaCierre === null ? '—' : formatPercent(r.tasaCierre)),
  },
  {
    key: 'importeGanado',
    header: 'Importe ganado',
    align: 'right',
    sortable: true,
    description: 'Suma del importe de los negocios ganados de este canal cuya fecha de cierre cae en el rango seleccionado.',
    render: (r) => formatCurrency(r.importeGanado, 0),
  },
]

const campaignColumns: Column<CampaignCpaRow>[] = [
  {
    key: 'campaign',
    header: 'Campaña',
    sortable: true,
    description: 'Nombre de campaña tal como llega en el utm_campaign de los formularios de HubSpot.',
    render: (r) => (
      <div>
        <p className="font-medium text-text-primary">{r.campaign}</p>
        {!r.platform && <p className="text-xs text-text-secondary">Sin campaña de pago asociada</p>}
      </div>
    ),
  },
  {
    key: 'platform',
    header: 'Plataforma',
    sortable: true,
    description: 'Plataforma donde existe una campaña con este mismo nombre — "—" si no hay coincidencia conocida.',
    render: (r) => r.platform ?? '—',
  },
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
  {
    key: 'adName',
    header: 'Anuncio',
    sortable: true,
    description: 'Anuncio de Meta Ads cuyo ad_id coincide con el utm_content de los contactos de HubSpot.',
  },
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

      <ChartCard
        title="Pipeline por etapa"
        noPadding
        action={
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            Histórico completo
            <InfoTooltip text="Este tablero no se filtra por el rango de fechas seleccionado: muestra el estado actual de todo el pipeline, como una foto del CRM en este momento." />
          </span>
        }
      >
        <div className="flex gap-3 overflow-x-auto p-4">
          {data.pipeline.map((stage) => (
            <div key={stage.stage} className="w-64 shrink-0 rounded-control border border-border bg-base">
              <div className="rounded-t-control border-b border-border bg-accent/10 px-3 py-2.5">
                <p className="truncate text-xs font-bold uppercase tracking-wide text-accent" title={stage.stage}>
                  {stage.stage}
                </p>
                <p className="mt-0.5 text-xs font-medium text-text-secondary">
                  {formatNumber(stage.count)} · {formatCurrency(stage.amount, 0)}
                </p>
              </div>
              <div className="max-h-96 space-y-1.5 overflow-y-auto p-2">
                {stage.deals.length === 0 && <p className="px-1 py-2 text-xs text-text-secondary">Sin negocios</p>}
                {stage.deals.map((deal) => (
                  <div key={deal.dealId} className="rounded-control border border-border bg-card px-2 py-1.5">
                    <p className="truncate text-sm font-medium text-text-primary" title={deal.company}>
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

      <ChartCard title="Contactos y tasa de cierre por canal">
        <DataTable columns={channelColumns} data={data.byChannel} rowKey={(r) => r.channel} />
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
