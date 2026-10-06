/**
 * Vercel Function: GET /api/paid?client=<slug>&from&to
 * Lee las métricas diarias de cada plataforma de paid media conectada
 * (Google Ads: tabla gads_campaign_daily; Meta Ads: tabla meta_campaign_daily;
 * TikTok Ads: tabla tiktok_campaign_daily) y las agrega en la forma que
 * espera PaidData (src/services/types.ts).
 *
 * invConv/invConvByPlatform incluyen `ingresos` (conversions_value sumado)
 * además de inversion/conversiones, para poder pintar una línea de ROAS
 * diario en el combo chart de Paid Media (no solo CPL).
 *
 * metaCreatives agrega meta_ad_daily (insights a nivel de anuncio) por
 * ad_id en el rango de fechas — vacío si el cliente no tiene Meta Ads
 * conectado o esa tabla aún no tiene filas para él.
 *
 * GET ?client=<slug>&mode=programmatic&from&to -> informes especiales de
 * publicidad programática (report_template = 'programmatic'): agrega
 * `programmatic_daily`, alimentada por importación manual desde el DSP
 * (Oniad u otro), sin conexión API en vivo. Vive en este mismo archivo (en
 * vez de en /api/programmatic.ts) para no superar el límite de Serverless
 * Functions del plan de Vercel — mismo motivo que /api/oauth-facebook.ts.
 *
 * GET ?client=<slug>&mode=negocio&from&to -> pestaña "Negocio": pipeline de
 * HubSpot (`hubspot_deals`) y coste de adquisición cruzando los contactos
 * de HubSpot (`hubspot_contacts`) con el gasto real de Google Ads/Meta Ads
 * por nombre de campaña (utm_campaign) y, en Meta Ads, por anuncio
 * (utm_content = ad_id de meta_ad_daily). Vive aquí por el mismo motivo que
 * `mode=programmatic` — no hay api/hubspot.ts ni api/business.ts.
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
): Promise<{ id: string } | null> {
  const url = `${supabaseUrl}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id`
  const resp = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!resp.ok) return null
  const rows = (await resp.json()) as Array<{ id: string }>
  return rows[0] ?? null
}

const SUPABASE_PAGE_SIZE = 1000

/** Lee todas las filas de una consulta paginando con Range — con rangos de
 * fecha largos (hasta 24 meses) el total puede superar el límite por
 * defecto de PostgREST de 1000 filas por respuesta. */
async function fetchAllRows<T>(url: string, headers: Record<string, string>, table: string): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  for (;;) {
    const resp = await fetch(url, { headers: { ...headers, Range: `${offset}-${offset + SUPABASE_PAGE_SIZE - 1}` } })
    if (!resp.ok) throw new Error(`Supabase respondió ${resp.status} al consultar ${table}.`)
    const page = (await resp.json()) as T[]
    all.push(...page)
    if (page.length < SUPABASE_PAGE_SIZE) break
    offset += SUPABASE_PAGE_SIZE
  }
  return all
}

function verifyUserToken(token: string, secret: string): string | null {
  try {
    const [userId, expiryStr, sig] = Buffer.from(token, 'base64url').toString('utf8').split('.')
    const expiry = Number(expiryStr)
    if (!userId || !expiry || !sig || Date.now() > expiry) return null
    const expected = createHmac('sha256', secret).update(`${userId}:${expiry}`).digest('hex')
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length) return null
    return timingSafeEqual(a, b) ? userId : null
  } catch {
    return null
  }
}

/** Comprueba que quien hace la petición es un usuario con acceso a este
 * cliente (admin: acceso implícito a todos; el resto: fila en
 * user_client_access). */
async function checkAccess(req: any, clientId: string, supabaseUrl: string, serviceRoleKey: string): Promise<boolean> {
  const secret = process.env.AUTH_TOKEN_SECRET
  if (!secret) return false
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const userId = token ? verifyUserToken(token, secret) : null
  if (!userId) return false
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  const userResp = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=role`, { headers })
  if (!userResp.ok) return false
  const [user] = (await userResp.json()) as Array<{ role: string }>
  if (!user) return false
  if (user.role === 'admin') return true
  const accessResp = await fetch(
    `${supabaseUrl}/rest/v1/user_client_access?user_id=eq.${userId}&client_id=eq.${clientId}&select=id`,
    { headers },
  )
  if (!accessResp.ok) return false
  const rows = (await accessResp.json()) as Array<{ id: string }>
  return rows.length > 0
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
  thumbnail_url: string | null
  impressions: string | number
  clicks: string | number
  cost: string | number
  conversions: string | number
  conversions_value: string | number
  frequency: string | number
}

type PlatformName = 'Google Ads' | 'Meta Ads' | 'TikTok Ads'

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
  { platform: 'TikTok Ads', dataSourcePlatform: 'tiktok-ads', table: 'tiktok_campaign_daily', accountColumn: 'advertiser_id' },
]

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export default async function handler(req: any, res: any) {
  try {
    if (req.query?.mode === 'programmatic') {
      await handleProgrammaticRequest(req, res)
    } else if (req.query?.mode === 'negocio') {
      await handleNegocioRequest(req, res)
    } else {
      await handleRequest(req, res)
    }
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

  let client: { id: string } | null
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
  if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
    res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
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

        return fetchAllRows<CampaignRow>(`${SUPABASE_URL}/rest/v1/${source.table}?${query.toString()}`, headers, source.table)
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
    // Serie diaria por campaña (para el gráfico "Eficiencia por campaña" —
    // una línea por campaña en vez de un único punto agregado del rango).
    const byCampaignDate = new Map<
      string,
      { platform: PlatformName; name: string; date: string; inversion: number; conversiones: number; ingresos: number }
    >()

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

        const cdKey = `${key}::${r.date}`
        const cd = byCampaignDate.get(cdKey) ?? {
          platform: source.platform,
          name: r.campaign_name,
          date: r.date,
          inversion: 0,
          conversiones: 0,
          ingresos: 0,
        }
        cd.name = r.campaign_name
        cd.inversion += Number(r.cost)
        cd.conversiones += Number(r.conversions)
        cd.ingresos += Number(r.conversions_value)
        byCampaignDate.set(cdKey, cd)
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

    const campaignDaily = Array.from(byCampaignDate.values())
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((v) => ({
        date: formatDateLabel(v.date),
        platform: v.platform,
        name: v.name,
        inversion: round2(v.inversion),
        conversiones: round2(v.conversiones),
        ingresos: round2(v.ingresos),
      }))

    // --- Creatividades Meta (nivel anuncio), solo si hay meta-ads conectado ---
    const metaAccountId = accountByPlatform.get('meta-ads') ?? ''
    let metaCreatives: Array<{
      adId: string
      name: string
      format: string
      thumbnailUrl: string | null
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
      const adRows = await fetchAllRows<AdRow>(`${SUPABASE_URL}/rest/v1/meta_ad_daily?${query.toString()}`, headers, 'meta_ad_daily')
      const byAd = new Map<
        string,
        { adId: string; name: string; format: string; thumbnailUrl: string | null; impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number; frequencySum: number; days: number }
      >()
      for (const r of adRows) {
        const cur = byAd.get(r.ad_id) ?? {
          adId: r.ad_id,
          name: r.ad_name,
          format: r.format || 'otro',
          thumbnailUrl: null,
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
        if (r.thumbnail_url) cur.thumbnailUrl = r.thumbnail_url
        byAd.set(r.ad_id, cur)
      }
      metaCreatives = Array.from(byAd.values()).map((c) => ({
        adId: c.adId,
        name: c.name,
        format: c.format,
        thumbnailUrl: c.thumbnailUrl,
        impresiones: c.impressions,
        clics: c.clicks,
        ctr: c.impressions ? round2((c.clicks / c.impressions) * 100) : 0,
        conversiones: round2(c.conversions),
        costeConv: c.conversions ? round2(c.cost / c.conversions) : 0,
        roas: c.cost ? round2(c.conversionsValue / c.cost) : 0,
        frecuencia: c.days ? round2(c.frequencySum / c.days) : 0,
      }))
    }

    res.status(200).json({
      campaigns,
      invConv,
      invConvByPlatform,
      campaignDaily,
      metaCreatives,
      metaAdAccountId: metaAccountId ? metaAccountId.replace(/^act_/, '') : null,
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer paid media desde Supabase.' })
  }
}

/* ============================================================================
 *  mode=programmatic — publicidad programática (informes especiales)
 * ========================================================================== */

interface ProgrammaticRow {
  date: string
  campaign_name: string
  medium: string
  banner: string
  impressions: number
  visible_impressions: number
  clicks: number
  cost: string | number
  viewability: string | number | null
  reach: number
  frequency: string | number | null
}

/** Lee todas las filas de programmatic_daily para el rango pedido — puede
 * haber varios miles, muy por encima del límite por defecto de PostgREST de
 * 1000, así que usa fetchAllRows para paginar con Range. */
async function fetchAllProgrammaticRows(
  supabaseUrl: string,
  headers: Record<string, string>,
  clientId: string,
  from: string,
  to: string,
): Promise<ProgrammaticRow[]> {
  const query = new URLSearchParams({ client_id: `eq.${clientId}`, order: 'date.asc' })
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
  return fetchAllRows<ProgrammaticRow>(`${supabaseUrl}/rest/v1/programmatic_daily?${query.toString()}`, headers, 'programmatic_daily')
}

/** Extrae el tamaño IAB del nombre de archivo de la creatividad (ej.
 * "...-300x250--1---1-.gif" -> "300x250"), null si no se reconoce. */
function extractCreativeSize(banner: string): string | null {
  const m = /(\d{2,4})x(\d{2,4})/.exec(banner)
  return m ? `${m[1]}x${m[2]}` : null
}

async function handleProgrammaticRequest(req: any, res: any) {
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

  let client: { id: string } | null
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
  if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
    res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
    return
  }

  const from = typeof req.query?.from === 'string' ? req.query.from : ''
  const to = typeof req.query?.to === 'string' ? req.query.to : ''
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  }

  try {
    const rows = await fetchAllProgrammaticRows(SUPABASE_URL, headers, client.id, from, to)

    let impressions = 0
    let visibleImpressions = 0
    let clicks = 0
    let cost = 0
    let reach = 0
    let viewabilitySum = 0
    let viewabilityCount = 0
    let frequencySum = 0
    let frequencyCount = 0

    const byDate = new Map<string, { impressions: number; clicks: number; cost: number }>()
    const byCampaign = new Map<string, { impressions: number; clicks: number; cost: number }>()
    const byMedium = new Map<string, { impressions: number; clicks: number; cost: number }>()
    const byBanner = new Map<string, { impressions: number; clicks: number; cost: number }>()

    for (const r of rows) {
      const rowImpressions = Number(r.impressions)
      const rowClicks = Number(r.clicks)
      const rowCost = Number(r.cost)

      impressions += rowImpressions
      visibleImpressions += Number(r.visible_impressions)
      clicks += rowClicks
      cost += rowCost
      reach += Number(r.reach)
      if (r.viewability !== null) {
        viewabilitySum += Number(r.viewability)
        viewabilityCount += 1
      }
      if (r.frequency !== null) {
        frequencySum += Number(r.frequency)
        frequencyCount += 1
      }

      const day = byDate.get(r.date) ?? { impressions: 0, clicks: 0, cost: 0 }
      day.impressions += rowImpressions
      day.clicks += rowClicks
      day.cost += rowCost
      byDate.set(r.date, day)

      const campaign = byCampaign.get(r.campaign_name) ?? { impressions: 0, clicks: 0, cost: 0 }
      campaign.impressions += rowImpressions
      campaign.clicks += rowClicks
      campaign.cost += rowCost
      byCampaign.set(r.campaign_name, campaign)

      const medium = byMedium.get(r.medium) ?? { impressions: 0, clicks: 0, cost: 0 }
      medium.impressions += rowImpressions
      medium.clicks += rowClicks
      medium.cost += rowCost
      byMedium.set(r.medium, medium)

      const banner = byBanner.get(r.banner) ?? { impressions: 0, clicks: 0, cost: 0 }
      banner.impressions += rowImpressions
      banner.clicks += rowClicks
      banner.cost += rowCost
      byBanner.set(r.banner, banner)
    }

    const withRatios = (impr: number, clk: number, c: number) => ({
      impresiones: impr,
      clics: clk,
      coste: round2(c),
      ctr: impr ? round2((clk / impr) * 100) : 0,
      cpm: impr ? round2((c / impr) * 1000) : 0,
      cpc: clk ? round2(c / clk) : 0,
    })

    const summary = {
      ...withRatios(impressions, clicks, cost),
      visibleImpressions,
      viewability: viewabilityCount ? round2(viewabilitySum / viewabilityCount) : 0,
      reach,
      frequency: frequencyCount ? round2(frequencySum / frequencyCount) : 0,
    }

    const daily = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => ({ date: formatDateLabel(date), ...withRatios(v.impressions, v.clicks, v.cost) }))

    const campaigns = Array.from(byCampaign.entries())
      .map(([name, v]) => ({ name, ...withRatios(v.impressions, v.clicks, v.cost) }))
      .sort((a, b) => b.impresiones - a.impresiones)

    const MAX_MEDIUMS = 30
    const allMediums = Array.from(byMedium.entries())
      .map(([medium, v]) => ({ medium, ...withRatios(v.impressions, v.clicks, v.cost) }))
      .sort((a, b) => b.impresiones - a.impresiones)
    const mediums = allMediums.slice(0, MAX_MEDIUMS)

    const creatives = Array.from(byBanner.entries())
      .map(([banner, v]) => ({ banner, size: extractCreativeSize(banner), ...withRatios(v.impressions, v.clicks, v.cost) }))
      .sort((a, b) => b.impresiones - a.impresiones)

    res.status(200).json({
      summary,
      daily,
      campaigns,
      mediums,
      mediumsOmitted: Math.max(0, allMediums.length - mediums.length),
      creatives,
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer publicidad programática desde Supabase.' })
  }
}

/* ============================================================================
 *  mode=negocio — HubSpot: pipeline + coste de adquisición por UTM
 * ========================================================================== */

interface HubspotContactRow {
  hubspot_contact_id: string
  utm_campaign: string | null
  utm_content: string | null
}

interface HubspotDealRow {
  stage_label: string | null
  stage_order: number | null
  is_closed: boolean
  is_won: boolean
  amount: string | number
  primary_contact_id: string | null
}

/** Mismo par Google Ads/Meta Ads de PAID_SOURCES, sin TikTok Ads (no pedido
 * para el cruce de coste de adquisición — y sin tabla de nivel-anuncio con
 * la que cruzar utm_content, a diferencia de Meta). */
const NEGOCIO_PAID_SOURCES: Array<{ platform: 'Google Ads' | 'Meta Ads'; dataSourcePlatform: string; table: string; accountColumn: string }> = [
  { platform: 'Google Ads', dataSourcePlatform: 'google-ads', table: 'gads_campaign_daily', accountColumn: 'customer_id' },
  { platform: 'Meta Ads', dataSourcePlatform: 'meta-ads', table: 'meta_campaign_daily', accountColumn: 'ad_account_id' },
]

async function handleNegocioRequest(req: any, res: any) {
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

  let client: { id: string } | null
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
  if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
    res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
    return
  }

  const from = typeof req.query?.from === 'string' ? req.query.from : ''
  const to = typeof req.query?.to === 'string' ? req.query.to : ''
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  }

  const EMPTY = {
    connected: false,
    totalContactos: 0,
    dealsAbiertos: 0,
    dealsGanados: 0,
    dealsPerdidos: 0,
    importeAbierto: 0,
    importeGanado: 0,
    tasaCierre: null as number | null,
    pipeline: [] as Array<{ stage: string; count: number; amount: number }>,
    byCampaign: [] as Array<{
      campaign: string
      platform: 'Google Ads' | 'Meta Ads' | null
      inversion: number
      contactos: number
      cpa: number | null
      deals: number
      dealsGanados: number
      importeGanado: number
    }>,
    byAd: [] as Array<{
      adId: string
      adName: string
      thumbnailUrl: string | null
      inversion: number
      contactos: number
      cpa: number | null
      deals: number
      dealsGanados: number
      importeGanado: number
    }>,
  }

  try {
    const sourcesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=in.(hubspot,google-ads,meta-ads)&select=platform,external_id,status`,
      { headers },
    )
    const sourceRows: Array<{ platform: string; external_id: string | null; status: string }> = sourcesResp.ok
      ? await sourcesResp.json()
      : []
    if (!sourceRows.some((s) => s.platform === 'hubspot' && s.status === 'conectado')) {
      res.status(200).json(EMPTY)
      return
    }
    const accountByPlatform = new Map(sourceRows.map((s) => [s.platform, s.external_id?.trim() ?? '']))

    // Igual que el resto de consultas por rango de este fichero, pero contra
    // columnas timestamptz (created_at/create_date) en vez de date: se acota
    // el día completo (00:00:00–23:59:59) en vez de comparar solo la fecha.
    const dateFilters = (col: string): Array<[string, string]> => {
      const parts: Array<[string, string]> = []
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) parts.push([col, `gte.${from}T00:00:00`])
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) parts.push([col, `lte.${to}T23:59:59`])
      return parts
    }

    const contactsQuery = new URLSearchParams({ client_id: `eq.${client.id}` })
    dateFilters('created_at').forEach(([k, v]) => contactsQuery.append(k, v))
    const contacts = await fetchAllRows<HubspotContactRow>(
      `${SUPABASE_URL}/rest/v1/hubspot_contacts?${contactsQuery.toString()}`,
      headers,
      'hubspot_contacts',
    )

    const dealsQuery = new URLSearchParams({ client_id: `eq.${client.id}` })
    dateFilters('create_date').forEach(([k, v]) => dealsQuery.append(k, v))
    const deals = await fetchAllRows<HubspotDealRow>(
      `${SUPABASE_URL}/rest/v1/hubspot_deals?${dealsQuery.toString()}`,
      headers,
      'hubspot_deals',
    )

    // El contacto asociado a un deal puede haberse creado fuera del rango de
    // fechas del informe (el deal es posterior) — para atribuir el deal a su
    // campaña/anuncio hace falta su utm igualmente, así que se resuelve
    // aparte de `contacts` (que sí respeta el rango, para "Contactos").
    const contactUtmById = new Map<string, { utm_campaign: string | null; utm_content: string | null }>()
    for (const c of contacts) contactUtmById.set(c.hubspot_contact_id, { utm_campaign: c.utm_campaign, utm_content: c.utm_content })
    const missingIds = Array.from(
      new Set(deals.map((d) => d.primary_contact_id).filter((id): id is string => !!id && !contactUtmById.has(id))),
    )
    const CHUNK = 100
    for (let i = 0; i < missingIds.length; i += CHUNK) {
      const chunk = missingIds.slice(i, i + CHUNK)
      const idsFilter = chunk.map((id) => encodeURIComponent(id)).join(',')
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/hubspot_contacts?client_id=eq.${client.id}&hubspot_contact_id=in.(${idsFilter})&select=hubspot_contact_id,utm_campaign,utm_content`,
        { headers },
      )
      if (!resp.ok) continue
      const rows: Array<{ hubspot_contact_id: string; utm_campaign: string | null; utm_content: string | null }> = await resp.json()
      for (const r of rows) contactUtmById.set(r.hubspot_contact_id, { utm_campaign: r.utm_campaign, utm_content: r.utm_content })
    }

    // --- Coste real por campaña (Google Ads + Meta Ads) y por anuncio (Meta) ---
    const campaignCost = new Map<'Google Ads' | 'Meta Ads', Map<string, number>>([
      ['Google Ads', new Map()],
      ['Meta Ads', new Map()],
    ])
    await Promise.all(
      NEGOCIO_PAID_SOURCES.map(async (source) => {
        const accountId = accountByPlatform.get(source.dataSourcePlatform) ?? ''
        if (!accountId) return
        const query = new URLSearchParams({ client_id: `eq.${client.id}` })
        query.set(source.accountColumn, `eq.${accountId}`)
        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
        const rows = await fetchAllRows<CampaignRow>(`${SUPABASE_URL}/rest/v1/${source.table}?${query.toString()}`, headers, source.table)
        const byName = campaignCost.get(source.platform)!
        for (const r of rows) byName.set(r.campaign_name, (byName.get(r.campaign_name) ?? 0) + Number(r.cost))
      }),
    )

    const adCost = new Map<string, { adName: string; thumbnailUrl: string | null; cost: number }>()
    const metaAccountId = accountByPlatform.get('meta-ads') ?? ''
    if (metaAccountId) {
      const query = new URLSearchParams({ client_id: `eq.${client.id}`, ad_account_id: `eq.${metaAccountId}` })
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
      const rows = await fetchAllRows<AdRow>(`${SUPABASE_URL}/rest/v1/meta_ad_daily?${query.toString()}`, headers, 'meta_ad_daily')
      for (const r of rows) {
        const cur = adCost.get(r.ad_id) ?? { adName: r.ad_name, thumbnailUrl: null, cost: 0 }
        cur.adName = r.ad_name
        cur.cost += Number(r.cost)
        if (r.thumbnail_url) cur.thumbnailUrl = r.thumbnail_url
        adCost.set(r.ad_id, cur)
      }
    }

    // --- Pipeline ---
    const pipelineMap = new Map<string, { stage: string; order: number; count: number; amount: number }>()
    let dealsAbiertos = 0
    let dealsGanados = 0
    let dealsPerdidos = 0
    let importeAbierto = 0
    let importeGanado = 0
    for (const d of deals) {
      const stage = d.stage_label || 'Sin etapa'
      const entry = pipelineMap.get(stage) ?? { stage, order: d.stage_order ?? 999, count: 0, amount: 0 }
      entry.count += 1
      entry.amount += Number(d.amount)
      pipelineMap.set(stage, entry)

      const amount = Number(d.amount)
      if (!d.is_closed) {
        dealsAbiertos += 1
        importeAbierto += amount
      } else if (d.is_won) {
        dealsGanados += 1
        importeGanado += amount
      } else {
        dealsPerdidos += 1
      }
    }
    const pipeline = Array.from(pipelineMap.values())
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ stage: s.stage, count: s.count, amount: round2(s.amount) }))
    const tasaCierre = dealsGanados + dealsPerdidos ? round2((dealsGanados / (dealsGanados + dealsPerdidos)) * 100) : null

    // --- Coste de adquisición por campaña (utm_campaign = nombre exacto) ---
    type CampaignBucket = {
      campaign: string
      platform: 'Google Ads' | 'Meta Ads' | null
      inversion: number
      contactos: number
      deals: number
      dealsGanados: number
      importeGanado: number
    }
    const campaignBuckets = new Map<string, CampaignBucket>()
    const matchingPlatforms = (name: string): Array<'Google Ads' | 'Meta Ads'> => {
      const out: Array<'Google Ads' | 'Meta Ads'> = []
      for (const [platform, byName] of campaignCost) if (byName.has(name)) out.push(platform)
      return out
    }
    // Si el mismo nombre de campaña existe a la vez en Google Ads y Meta Ads
    // (coincidencia infrecuente), se genera una fila por plataforma, cada una
    // con el contacto/deal completo — no hay más señal que el nombre para
    // saber de cuál vino exactamente. Si no coincide con ninguna, cae en una
    // única fila "platform: null" ("Sin campaña de pago asociada").
    const getCampaignBucket = (name: string, platform: 'Google Ads' | 'Meta Ads' | null): CampaignBucket => {
      const key = `${name}::${platform ?? 'none'}`
      let b = campaignBuckets.get(key)
      if (!b) {
        b = {
          campaign: name,
          platform,
          inversion: platform ? campaignCost.get(platform)!.get(name) ?? 0 : 0,
          contactos: 0,
          deals: 0,
          dealsGanados: 0,
          importeGanado: 0,
        }
        campaignBuckets.set(key, b)
      }
      return b
    }
    for (const c of contacts) {
      if (!c.utm_campaign) continue
      const platforms = matchingPlatforms(c.utm_campaign)
      const targets = platforms.length ? platforms : [null]
      for (const p of targets) getCampaignBucket(c.utm_campaign, p).contactos += 1
    }
    for (const d of deals) {
      const contact = d.primary_contact_id ? contactUtmById.get(d.primary_contact_id) : undefined
      const name = contact?.utm_campaign
      if (!name) continue
      const platforms = matchingPlatforms(name)
      const targets = platforms.length ? platforms : [null]
      const amount = Number(d.amount)
      for (const p of targets) {
        const b = getCampaignBucket(name, p)
        b.deals += 1
        if (d.is_won) {
          b.dealsGanados += 1
          b.importeGanado += amount
        }
      }
    }
    const byCampaign = Array.from(campaignBuckets.values())
      .map((b) => ({
        campaign: b.campaign,
        platform: b.platform,
        inversion: round2(b.inversion),
        contactos: b.contactos,
        cpa: b.inversion && b.contactos ? round2(b.inversion / b.contactos) : null,
        deals: b.deals,
        dealsGanados: b.dealsGanados,
        importeGanado: round2(b.importeGanado),
      }))
      .sort((a, b) => b.inversion - a.inversion)

    // --- Coste de adquisición por anuncio (utm_content = ad_id, solo Meta
    //     Ads: es la única plataforma con datos de coste a nivel de anuncio
    //     ya ingeridos, en meta_ad_daily) ---
    type AdBucket = {
      adId: string
      adName: string
      thumbnailUrl: string | null
      inversion: number
      contactos: number
      deals: number
      dealsGanados: number
      importeGanado: number
    }
    const adBuckets = new Map<string, AdBucket>()
    const getAdBucket = (adId: string): AdBucket | null => {
      const ad = adCost.get(adId)
      if (!ad) return null // utm_content no coincide con ningún ad_id de Meta en este rango
      let b = adBuckets.get(adId)
      if (!b) {
        b = { adId, adName: ad.adName, thumbnailUrl: ad.thumbnailUrl, inversion: ad.cost, contactos: 0, deals: 0, dealsGanados: 0, importeGanado: 0 }
        adBuckets.set(adId, b)
      }
      return b
    }
    for (const c of contacts) {
      if (!c.utm_content) continue
      const b = getAdBucket(c.utm_content)
      if (b) b.contactos += 1
    }
    for (const d of deals) {
      const contact = d.primary_contact_id ? contactUtmById.get(d.primary_contact_id) : undefined
      const adId = contact?.utm_content
      if (!adId) continue
      const b = getAdBucket(adId)
      if (!b) continue
      b.deals += 1
      if (d.is_won) {
        b.dealsGanados += 1
        b.importeGanado += Number(d.amount)
      }
    }
    const byAd = Array.from(adBuckets.values())
      .map((b) => ({
        adId: b.adId,
        adName: b.adName,
        thumbnailUrl: b.thumbnailUrl,
        inversion: round2(b.inversion),
        contactos: b.contactos,
        cpa: b.inversion && b.contactos ? round2(b.inversion / b.contactos) : null,
        deals: b.deals,
        dealsGanados: b.dealsGanados,
        importeGanado: round2(b.importeGanado),
      }))
      .sort((a, b) => b.inversion - a.inversion)

    res.status(200).json({
      connected: true,
      totalContactos: contacts.length,
      dealsAbiertos,
      dealsGanados,
      dealsPerdidos,
      importeAbierto: round2(importeAbierto),
      importeGanado: round2(importeGanado),
      tasaCierre,
      pipeline,
      byCampaign,
      byAd,
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer datos de negocio desde Supabase.' })
  }
}
