/**
 * Vercel Function: GET /api/paid?client=<slug>&from&to
 * Lee las métricas diarias de cada plataforma de paid media conectada
 * (Google Ads: tabla gads_campaign_daily; Meta Ads: tabla meta_campaign_daily)
 * y las agrega en la forma que espera PaidData (src/services/types.ts).
 * TikTok Ads se añadirá del mismo modo cuando tenga su propia tabla/integración.
 *
 * invConv/invConvByPlatform incluyen `ingresos` (conversions_value sumado)
 * además de inversion/conversiones, para poder pintar una línea de ROAS
 * diario en el combo chart de Paid Media (no solo CPL).
 *
 * metaCreatives agrega meta_ad_daily (insights a nivel de anuncio) por
 * ad_id en el rango de fechas — vacío si el cliente no tiene Meta Ads
 * conectado o esa tabla aún no tiene filas para él.
 *
 * El deployment es compartido por todos los clientes: el cliente se resuelve
 * en cada petición a partir del slug de la URL (?client=), no de una variable
 * de entorno fija.
 *
 * Variables de entorno requeridas (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { timingSafeEqual, createHmac } from 'crypto'

async function resolveClient(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
): Promise<{ id: string; access_password_hash: string | null } | null> {
  const url = `${supabaseUrl}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id,access_password_hash`
  const resp = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!resp.ok) return null
  const rows = (await resp.json()) as Array<{ id: string; access_password_hash: string | null }>
  return rows[0] ?? null
}

function verifyToken(token: string, subject: string, secret: string): boolean {
  const [expiryStr, sig] = token.split('.')
  const expiry = Number(expiryStr)
  if (!expiry || !sig || Date.now() > expiry) return false
  const expected = createHmac('sha256', secret).update(`${subject}:${expiry}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function checkAccess(req: any, client: { access_password_hash: string | null }, slug: string): boolean {
  if (!client.access_password_hash) return true
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secret = process.env.AUTH_TOKEN_SECRET
  return !!secret && !!token && verifyToken(token, slug, secret)
}

interface CampaignRow {
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

interface AdRow {
  ad_id: string
  ad_name: string
  format: string | null
  impressions: string | number
  clicks: string | number
  cost: string | number
  conversions: string | number
  conversions_value: string | number
  frequency: string | number
}

type PlatformName = 'Google Ads' | 'Meta Ads'

/** Una fuente de paid media = su tabla y la columna que identifica la cuenta
 * (para ignorar datos de una cuenta anterior si el cliente cambia de ID). */
const PAID_SOURCES: Array<{
  platform: PlatformName
  dataSourcePlatform: string
  table: string
  accountColumn: string
}> = [
  { platform: 'Google Ads', dataSourcePlatform: 'google-ads', table: 'gads_campaign_daily', accountColumn: 'customer_id' },
  { platform: 'Meta Ads', dataSourcePlatform: 'meta-ads', table: 'meta_campaign_daily', accountColumn: 'ad_account_id' },
]

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/paid: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
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

  let client: { id: string; access_password_hash: string | null } | null
  try {
    client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  } catch (e) {
    res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
    return
  }
  if (!client) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }
  if (!checkAccess(req, client, slug)) {
    res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
    return
  }

  const from = typeof req.query?.from === 'string' ? req.query.from : ''
  const to = typeof req.query?.to === 'string' ? req.query.to : ''

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  }

  try {
    // Cuenta actualmente configurada por plataforma (data_sources), para no
    // mezclar datos de una cuenta anterior si el cliente cambia de ID.
    const sourcesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=in.(${PAID_SOURCES.map((s) => s.dataSourcePlatform).join(',')})&select=platform,external_id`,
      { headers },
    )
    const sourceRows: Array<{ platform: string; external_id: string | null }> = sourcesResp.ok
      ? await sourcesResp.json()
      : []
    const accountByPlatform = new Map(sourceRows.map((s) => [s.platform, s.external_id?.trim() ?? '']))

    const rowsByPlatform = await Promise.all(
      PAID_SOURCES.map(async (source) => {
        const accountId = accountByPlatform.get(source.dataSourcePlatform) ?? ''
        if (!accountId) return [] as CampaignRow[]

        const query = new URLSearchParams({ client_id: `eq.${client.id}`, order: 'date.asc' })
        query.set(source.accountColumn, `eq.${accountId}`)
        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)

        const resp = await fetch(`${SUPABASE_URL}/rest/v1/${source.table}?${query.toString()}`, { headers })
        if (!resp.ok) {
          throw new Error(`Supabase respondió ${resp.status} al consultar ${source.table}.`)
        }
        return (await resp.json()) as CampaignRow[]
      }),
    )

    const byCampaign = new Map<
      string,
      { platform: PlatformName; name: string; status: string; cost: number; impressions: number; clicks: number; conversions: number; conversionsValue: number }
    >()
    const byDate = new Map<string, { inversion: number; conversiones: number; ingresos: number }>()
    // Serie diaria por plataforma, para que las pestañas de Google/Meta no
    // mezclen inversión ni conversiones de otras plataformas.
    const byDatePlatform = new Map<
      PlatformName,
      Map<string, { inversion: number; conversiones: number; ingresos: number }>
    >(PAID_SOURCES.map((s) => [s.platform, new Map()]))

    PAID_SOURCES.forEach((source, i) => {
      for (const r of rowsByPlatform[i]) {
        const key = `${source.platform}::${r.campaign_id}`
        const campaign = byCampaign.get(key) ?? {
          platform: source.platform,
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
        byCampaign.set(key, campaign)

        const day = byDate.get(r.date) ?? { inversion: 0, conversiones: 0, ingresos: 0 }
        day.inversion += Number(r.cost)
        day.conversiones += Number(r.conversions)
        day.ingresos += Number(r.conversions_value)
        byDate.set(r.date, day)

        const platformDates = byDatePlatform.get(source.platform)!
        const platformDay = platformDates.get(r.date) ?? { inversion: 0, conversiones: 0, ingresos: 0 }
        platformDay.inversion += Number(r.cost)
        platformDay.conversiones += Number(r.conversions)
        platformDay.ingresos += Number(r.conversions_value)
        platformDates.set(r.date, platformDay)
      }
    })

    const campaigns = Array.from(byCampaign.values()).map((c) => ({
      platform: c.platform,
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
        ingresos: round2(v.ingresos),
      }))

    const invConvByPlatform: Record<string, { date: string; inversion: number; conversiones: number; ingresos: number }[]> = {}
    for (const source of PAID_SOURCES) {
      invConvByPlatform[source.platform] = Array.from(byDatePlatform.get(source.platform)!.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, v]) => ({
          date: formatDateLabel(date),
          inversion: round2(v.inversion),
          conversiones: round2(v.conversiones),
          ingresos: round2(v.ingresos),
        }))
    }

    // --- Creatividades Meta (nivel anuncio), solo si hay meta-ads conectado ---
    const metaAccountId = accountByPlatform.get('meta-ads') ?? ''
    let metaCreatives: Array<{
      name: string
      format: string
      impresiones: number
      clics: number
      ctr: number
      conversiones: number
      costeConv: number
      roas: number
      frecuencia: number
    }> = []
    if (metaAccountId) {
      const query = new URLSearchParams({ client_id: `eq.${client.id}`, ad_account_id: `eq.${metaAccountId}` })
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
      const adsResp = await fetch(`${SUPABASE_URL}/rest/v1/meta_ad_daily?${query.toString()}`, { headers })
      if (adsResp.ok) {
        const adRows = (await adsResp.json()) as AdRow[]
        const byAd = new Map<
          string,
          { name: string; format: string; impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number; frequencySum: number; days: number }
        >()
        for (const r of adRows) {
          const cur = byAd.get(r.ad_id) ?? {
            name: r.ad_name,
            format: r.format || 'otro',
            impressions: 0,
            clicks: 0,
            cost: 0,
            conversions: 0,
            conversionsValue: 0,
            frequencySum: 0,
            days: 0,
          }
          cur.impressions += Number(r.impressions)
          cur.clicks += Number(r.clicks)
          cur.cost += Number(r.cost)
          cur.conversions += Number(r.conversions)
          cur.conversionsValue += Number(r.conversions_value)
          cur.frequencySum += Number(r.frequency)
          cur.days += 1
          byAd.set(r.ad_id, cur)
        }
        metaCreatives = Array.from(byAd.values()).map((c) => ({
          name: c.name,
          format: c.format,
          impresiones: c.impressions,
          clics: c.clicks,
          ctr: c.impressions ? round2((c.clicks / c.impressions) * 100) : 0,
          conversiones: round2(c.conversions),
          costeConv: c.conversions ? round2(c.cost / c.conversions) : 0,
          roas: c.cost ? round2(c.conversionsValue / c.cost) : 0,
          frecuencia: c.days ? round2(c.frequencySum / c.days) : 0,
        }))
      }
    }

    res.status(200).json({ campaigns, invConv, invConvByPlatform, metaCreatives })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer paid media desde Supabase.' })
  }
}
