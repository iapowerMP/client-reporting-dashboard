/**
 * Vercel Function: GET /api/programmatic?client=<slug>&from&to
 * Informes especiales de publicidad programática (report_template =
 * 'programmatic'): lee `programmatic_daily`, alimentada por una importación
 * manual desde el DSP (Oniad u otro), sin conexión API en vivo.
 *
 * programmatic_daily puede tener miles de filas (una por día+sitio+
 * creatividad) — muy por encima del límite por defecto de PostgREST (1000),
 * así que aquí sí se pagina la lectura con el header Range, a diferencia del
 * resto de endpoints donde el volumen nunca lo requiere.
 *
 * Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { timingSafeEqual, createHmac } from 'crypto'

const PAGE_SIZE = 1000

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

/** Lee todas las filas de programmatic_daily para el rango pedido, paginando
 * con Range porque puede haber varios miles. */
async function fetchAllRows(
  supabaseUrl: string,
  headers: Record<string, string>,
  clientId: string,
  from: string,
  to: string,
): Promise<ProgrammaticRow[]> {
  const query = new URLSearchParams({ client_id: `eq.${clientId}`, order: 'date.asc' })
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)

  const all: ProgrammaticRow[] = []
  let offset = 0
  for (;;) {
    const resp = await fetch(`${supabaseUrl}/rest/v1/programmatic_daily?${query.toString()}`, {
      headers: { ...headers, Range: `${offset}-${offset + PAGE_SIZE - 1}` },
    })
    if (!resp.ok) throw new Error(`Supabase respondió ${resp.status} al consultar programmatic_daily.`)
    const page = (await resp.json()) as ProgrammaticRow[]
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return all
}

/** Extrae el tamaño IAB del nombre de archivo de la creatividad (ej.
 * "...-300x250--1---1-.gif" -> "300x250"), null si no se reconoce. */
function extractSize(banner: string): string | null {
  const m = /(\d{2,4})x(\d{2,4})/.exec(banner)
  return m ? `${m[1]}x${m[2]}` : null
}

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/programmatic: ${(e as Error).message}` })
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
    const rows = await fetchAllRows(SUPABASE_URL, headers, client.id, from, to)

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
      .map(([banner, v]) => ({ banner, size: extractSize(banner), ...withRatios(v.impressions, v.clicks, v.cost) }))
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
