/**
 * Vercel Function: GET /api/paid?client=<slug>
 * Lee las métricas diarias de Google Ads desde Supabase (tabla
 * gads_campaign_daily) y las agrega en la forma que espera PaidData
 * (src/services/types.ts). Meta Ads y TikTok Ads se añadirán del mismo modo
 * cuando tengan su propia tabla / integración.
 *
 * El deployment es compartido por todos los clientes: el cliente se resuelve
 * en cada petición a partir del slug de la URL (?client=), no de una variable
 * de entorno fija.
 *
 * Variables de entorno requeridas (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { resolveClientId } from './_lib/resolveClient'

interface GadsRow {
  date: string
  campaign_id: string
  campaign_name: string
  status: string
  cost: string | number
  impressions: string | number
  clicks: string | number
  conversions: string | number
  conversions_value: string | number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export default async function handler(req: any, res: any) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
    })
    return
  }

  const slug = typeof req.query?.client === 'string' ? req.query.client : ''
  if (!slug) {
    res.status(400).json({ error: 'Falta el parámetro client en la petición.' })
    return
  }

  const clientId = await resolveClientId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  if (!clientId) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }

  const query = new URLSearchParams({
    client_id: `eq.${clientId}`,
    order: 'date.asc',
  })

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/gads_campaign_daily?${query.toString()}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })

    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al consultar gads_campaign_daily.` })
      return
    }

    const rows = (await resp.json()) as GadsRow[]

    const byCampaign = new Map<
      string,
      { name: string; status: string; cost: number; impressions: number; clicks: number; conversions: number; conversionsValue: number }
    >()
    const byDate = new Map<string, { inversion: number; conversiones: number }>()

    for (const r of rows) {
      const campaign = byCampaign.get(r.campaign_id) ?? {
        name: r.campaign_name,
        status: r.status,
        cost: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionsValue: 0,
      }
      campaign.status = r.status
      campaign.cost += Number(r.cost)
      campaign.impressions += Number(r.impressions)
      campaign.clicks += Number(r.clicks)
      campaign.conversions += Number(r.conversions)
      campaign.conversionsValue += Number(r.conversions_value)
      byCampaign.set(r.campaign_id, campaign)

      const day = byDate.get(r.date) ?? { inversion: 0, conversiones: 0 }
      day.inversion += Number(r.cost)
      day.conversiones += Number(r.conversions)
      byDate.set(r.date, day)
    }

    const campaigns = Array.from(byCampaign.values()).map((c) => ({
      platform: 'Google Ads' as const,
      name: c.name,
      status: c.status === 'ENABLED' || c.status === 'Activa' ? ('Activa' as const) : ('Pausada' as const),
      inversion: round2(c.cost),
      impresiones: c.impressions,
      clics: c.clicks,
      ctr: c.impressions ? round2((c.clicks / c.impressions) * 100) : 0,
      cpc: c.clicks ? round2(c.cost / c.clicks) : 0,
      conversiones: round2(c.conversions),
      roas: c.cost ? round2(c.conversionsValue / c.cost) : 0,
    }))

    const invConv = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => ({
        date: formatDateLabel(date),
        inversion: round2(v.inversion),
        conversiones: round2(v.conversiones),
      }))

    const totalInversion = round2(campaigns.reduce((s, c) => s + c.inversion, 0))
    const distribution = totalInversion
      ? [{ name: 'Google Ads', value: totalInversion, percent: '100,0%', color: '#34A853' }]
      : []

    const topRoas = [...campaigns]
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 5)
      .map((c) => ({ name: c.name, roas: c.roas }))

    res.status(200).json({ campaigns, invConv, distribution, topRoas })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Google Ads desde Supabase.' })
  }
}
