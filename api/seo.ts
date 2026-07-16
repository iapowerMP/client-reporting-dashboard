/**
 * Vercel Function: GET /api/seo?client=<slug>&from&to
 * Lee las métricas diarias de GA4 (ga4_daily) y Search Console
 * (gsc_query_daily/gsc_page_daily) y las agrega en la forma que espera
 * SeoData (src/services/types.ts). Semrush todavía no tiene integración
 * real: sus campos se devuelven vacíos con honestidad, en vez de simular
 * datos que no existen.
 *
 * El deployment es compartido por todos los clientes: el cliente se resuelve
 * en cada petición a partir del slug de la URL (?client=), no de una
 * variable de entorno fija.
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

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n))
}

function formatPercent(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`
}

function formatPosition(n: number): string {
  return n.toFixed(1).replace('.', ',')
}

interface Ga4Row {
  date: string
  channel: string
  sessions: string | number
  users: string | number
  new_users: string | number
  engaged_sessions: string | number
  conversions: string | number
}

interface GscRow {
  date: string
  clicks: string | number
  impressions: string | number
  ctr: string | number
  position: string | number
}

interface GscQueryRow extends GscRow {
  query: string
}

interface GscPageRow extends GscRow {
  page: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Agrega filas de Search Console (por query o por página) en un ranking
 * top-N por clics, sumando impresiones/clics y ponderando la posición por
 * impresiones (más fiel que una media simple). */
function topN(rows: Array<{ label: string; clicks: number; impressions: number }>, n: number) {
  const byLabel = new Map<string, { clicks: number; impressions: number; positionWeighted: number }>()
  for (const r of rows) {
    const cur = byLabel.get(r.label) ?? { clicks: 0, impressions: 0, positionWeighted: 0 }
    cur.clicks += r.clicks
    cur.impressions += r.impressions
    byLabel.set(r.label, cur)
  }
  return Array.from(byLabel.entries())
    .map(([label, v]) => ({
      label,
      clics: v.clicks,
      impresiones: v.impressions,
      ctr: v.impressions ? round2((v.clicks / v.impressions) * 100) : 0,
      posicion: 0, // se completa fuera, donde sí tenemos la posición ponderada por fila
    }))
    .sort((a, b) => b.clics - a.clics)
    .slice(0, n)
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/seo: ${(e as Error).message}` })
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

  const client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
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
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  const dateFilters = (query: URLSearchParams) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
  }

  try {
    // ---------------------------------------------------------------- GA4 --
    const ga4SourceResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=eq.ga4&select=external_id`,
      { headers },
    )
    const [ga4Source] = ga4SourceResp.ok ? ((await ga4SourceResp.json()) as Array<{ external_id: string | null }>) : []
    const propertyId = ga4Source?.external_id?.trim() ?? ''

    let ga4Rows: Ga4Row[] = []
    if (propertyId) {
      const query = new URLSearchParams({ client_id: `eq.${client.id}`, property_id: `eq.${propertyId}`, order: 'date.asc' })
      dateFilters(query)
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/ga4_daily?${query.toString()}`, { headers })
      if (!resp.ok) throw new Error(`Supabase respondió ${resp.status} al consultar ga4_daily.`)
      ga4Rows = (await resp.json()) as Ga4Row[]
    }

    const sessionsByDate = new Map<string, number>()
    const byChannel = new Map<string, number>()
    let totalSessions = 0
    let totalUsers = 0
    let totalNewUsers = 0
    let totalEngaged = 0
    for (const r of ga4Rows) {
      const sessions = Number(r.sessions)
      sessionsByDate.set(r.date, (sessionsByDate.get(r.date) ?? 0) + sessions)
      byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + sessions)
      totalSessions += sessions
      totalUsers += Number(r.users)
      totalNewUsers += Number(r.new_users)
      totalEngaged += Number(r.engaged_sessions)
    }
    const bounceRate = totalSessions ? Math.max(0, 100 - (totalEngaged / totalSessions) * 100) : 0

    const channels = Array.from(byChannel.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([channel, value]) => ({ channel, value, organic: channel === 'Organic Search' }))

    const kpisGa4 = [
      { label: 'Sesiones', value: formatNumber(totalSessions) },
      { label: 'Usuarios', value: formatNumber(totalUsers) },
      { label: 'Nuevos usuarios', value: formatNumber(totalNewUsers) },
      { label: 'Tasa de rebote', value: formatPercent(bounceRate) },
    ]

    // ------------------------------------------------------- Search Console --
    const gscSourceResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=eq.gsc&select=external_id`,
      { headers },
    )
    const [gscSource] = gscSourceResp.ok ? ((await gscSourceResp.json()) as Array<{ external_id: string | null }>) : []
    const siteUrl = gscSource?.external_id?.trim() ?? ''

    let queryRows: GscQueryRow[] = []
    let pageRows: GscPageRow[] = []
    if (siteUrl) {
      const baseQuery = () => {
        const q = new URLSearchParams({ client_id: `eq.${client.id}`, site_url: `eq.${siteUrl}`, order: 'date.asc' })
        dateFilters(q)
        return q
      }
      const [queryResp, pageResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/gsc_query_daily?${baseQuery().toString()}`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/gsc_page_daily?${baseQuery().toString()}`, { headers }),
      ])
      if (!queryResp.ok) throw new Error(`Supabase respondió ${queryResp.status} al consultar gsc_query_daily.`)
      if (!pageResp.ok) throw new Error(`Supabase respondió ${pageResp.status} al consultar gsc_page_daily.`)
      queryRows = (await queryResp.json()) as GscQueryRow[]
      pageRows = (await pageResp.json()) as GscPageRow[]
    }

    // Serie diaria + posición media ponderada por impresiones, a partir de
    // las filas por query (sumadas, reconstruyen el total diario del sitio).
    const clicksByDate = new Map<string, number>()
    const impressionsByDate = new Map<string, number>()
    const positionWeightedByDate = new Map<string, number>()
    let totalClicks = 0
    let totalImpressions = 0
    let totalPositionWeighted = 0
    for (const r of queryRows) {
      const clicks = Number(r.clicks)
      const impressions = Number(r.impressions)
      const position = Number(r.position)
      clicksByDate.set(r.date, (clicksByDate.get(r.date) ?? 0) + clicks)
      impressionsByDate.set(r.date, (impressionsByDate.get(r.date) ?? 0) + impressions)
      positionWeightedByDate.set(r.date, (positionWeightedByDate.get(r.date) ?? 0) + position * impressions)
      totalClicks += clicks
      totalImpressions += impressions
      totalPositionWeighted += position * impressions
    }
    const gscDates = Array.from(clicksByDate.keys()).sort()
    const trafficGsc = gscDates.map((date) => ({
      date: formatDateLabel(date),
      sesiones: 0,
      clics: clicksByDate.get(date) ?? 0,
    }))
    const position = gscDates.map((date) => {
      const impressions = impressionsByDate.get(date) ?? 0
      const weighted = positionWeightedByDate.get(date) ?? 0
      return { date: formatDateLabel(date), position: impressions ? round2(weighted / impressions) : 0 }
    })
    const avgPosition = totalImpressions ? totalPositionWeighted / totalImpressions : 0
    const avgCtr = totalImpressions ? (totalClicks / totalImpressions) * 100 : 0

    const kpisGsc = siteUrl
      ? [
          { label: 'Clics orgánicos', value: formatNumber(totalClicks) },
          { label: 'CTR orgánico', value: formatPercent(avgCtr) },
          { label: 'Posición media', value: formatPosition(avgPosition) },
        ]
      : []

    // Top queries / páginas: top-N por clics, con posición ponderada propia.
    const queryPosByLabel = new Map<string, { impressions: number; weighted: number }>()
    for (const r of queryRows) {
      const cur = queryPosByLabel.get(r.query) ?? { impressions: 0, weighted: 0 }
      cur.impressions += Number(r.impressions)
      cur.weighted += Number(r.position) * Number(r.impressions)
      queryPosByLabel.set(r.query, cur)
    }
    const topQueries = topN(
      queryRows.map((r) => ({ label: r.query, clicks: Number(r.clicks), impressions: Number(r.impressions) })),
      10,
    ).map((row) => {
      const pos = queryPosByLabel.get(row.label)
      return { ...row, posicion: pos && pos.impressions ? round2(pos.weighted / pos.impressions) : 0 }
    })

    const pagePosByLabel = new Map<string, { impressions: number; weighted: number }>()
    for (const r of pageRows) {
      const cur = pagePosByLabel.get(r.page) ?? { impressions: 0, weighted: 0 }
      cur.impressions += Number(r.impressions)
      cur.weighted += Number(r.position) * Number(r.impressions)
      pagePosByLabel.set(r.page, cur)
    }
    const topPages = topN(
      pageRows.map((r) => ({ label: r.page, clicks: Number(r.clicks), impressions: Number(r.impressions) })),
      10,
    ).map((row) => {
      const pos = pagePosByLabel.get(row.label)
      return { ...row, posicion: pos && pos.impressions ? round2(pos.weighted / pos.impressions) : 0 }
    })

    // ------------------------------------------------------------ Combinado --
    const trafficGa4 = Array.from(sessionsByDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, sesiones]) => ({ date: formatDateLabel(date), sesiones, clics: 0 }))

    const combinedByDate = new Map<string, { sesiones: number; clics: number }>()
    for (const [date, sesiones] of sessionsByDate) {
      const label = formatDateLabel(date)
      combinedByDate.set(label, { sesiones, clics: combinedByDate.get(label)?.clics ?? 0 })
    }
    for (const date of gscDates) {
      const label = formatDateLabel(date)
      const clics = clicksByDate.get(date) ?? 0
      combinedByDate.set(label, { sesiones: combinedByDate.get(label)?.sesiones ?? 0, clics })
    }
    const traffic = Array.from(combinedByDate.entries()).map(([date, v]) => ({ date, ...v }))

    res.status(200).json({
      kpis: [...kpisGa4, ...kpisGsc],
      traffic,
      channels,
      position,
      topQueries,
      topPages,
      kpisByTool: { GA4: kpisGa4, 'Search Console': kpisGsc },
      trafficByTool: { GA4: trafficGa4, 'Search Console': trafficGsc },
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer SEO desde Supabase.' })
  }
}
