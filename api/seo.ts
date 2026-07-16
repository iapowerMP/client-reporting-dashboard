/**
 * Vercel Function: GET /api/seo?client=<slug>&from&to
 * Lee las métricas diarias de GA4 (tabla ga4_daily) y las agrega en la forma
 * que espera SeoData (src/services/types.ts). Search Console y Semrush
 * todavía no tienen integración real: sus campos (position, topQueries,
 * topPages, kpisByTool['Search Console']) se devuelven vacíos con
 * honestidad, en vez de simular datos que no existen.
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

interface Ga4Row {
  date: string
  channel: string
  sessions: string | number
  users: string | number
  new_users: string | number
  engaged_sessions: string | number
  conversions: string | number
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

  try {
    const sourceResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=eq.ga4&select=external_id`,
      { headers },
    )
    const [source] = sourceResp.ok ? ((await sourceResp.json()) as Array<{ external_id: string | null }>) : []
    const propertyId = source?.external_id?.trim() ?? ''

    let rows: Ga4Row[] = []
    if (propertyId) {
      const query = new URLSearchParams({ client_id: `eq.${client.id}`, property_id: `eq.${propertyId}`, order: 'date.asc' })
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/ga4_daily?${query.toString()}`, { headers })
      if (!resp.ok) throw new Error(`Supabase respondió ${resp.status} al consultar ga4_daily.`)
      rows = (await resp.json()) as Ga4Row[]
    }

    const byDate = new Map<string, number>()
    const byChannel = new Map<string, number>()
    let totalSessions = 0
    let totalUsers = 0
    let totalNewUsers = 0
    let totalEngaged = 0
    for (const r of rows) {
      const sessions = Number(r.sessions)
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + sessions)
      byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + sessions)
      totalSessions += sessions
      totalUsers += Number(r.users)
      totalNewUsers += Number(r.new_users)
      totalEngaged += Number(r.engaged_sessions)
    }
    const bounceRate = totalSessions ? Math.max(0, 100 - (totalEngaged / totalSessions) * 100) : 0

    const trafficGa4 = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, sesiones]) => ({ date: formatDateLabel(date), sesiones, clics: 0 }))

    const channels = Array.from(byChannel.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([channel, value]) => ({ channel, value, organic: channel === 'Organic Search' }))

    const kpisGa4 = [
      { label: 'Sesiones', value: formatNumber(totalSessions) },
      { label: 'Usuarios', value: formatNumber(totalUsers) },
      { label: 'Nuevos usuarios', value: formatNumber(totalNewUsers) },
      { label: 'Tasa de rebote', value: formatPercent(bounceRate) },
    ]

    // Search Console / Semrush: sin integración real todavía.
    const kpisGsc: { label: string; value: string }[] = []

    res.status(200).json({
      kpis: kpisGa4,
      traffic: trafficGa4,
      channels,
      position: [],
      topQueries: [],
      topPages: [],
      kpisByTool: { GA4: kpisGa4, 'Search Console': kpisGsc },
      trafficByTool: { GA4: trafficGa4, 'Search Console': [] },
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer SEO desde Supabase.' })
  }
}
