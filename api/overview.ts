/**
 * Vercel Function: GET /api/overview?client=<slug>&from&to
 * Resumen agregado de las 3 áreas del informe (para la vista Overview):
 *   - Paid Media: se calcula a partir de las mismas tablas que /api/paid
 *     (gads_campaign_daily, meta_campaign_daily), filtradas por la cuenta
 *     actualmente configurada.
 *   - SEO: a partir de ga4_daily, si GA4 está conectado.
 *   - Redes Sociales: todavía no tiene ninguna integración real, así que se
 *     devuelve en cero — nada de cifras inventadas mientras no exista.
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

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

const PAID_SOURCES = [
  { dataSourcePlatform: 'google-ads', table: 'gads_campaign_daily', accountColumn: 'customer_id' },
  { dataSourcePlatform: 'meta-ads', table: 'meta_campaign_daily', accountColumn: 'ad_account_id' },
]

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/overview: ${(e as Error).message}` })
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
  if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
    res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
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
    // --- Paid Media: mismas tablas/aislamiento de cuenta que /api/paid ---
    const sourcesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=in.(google-ads,meta-ads)&select=platform,external_id`,
      { headers },
    )
    const sourceRows: Array<{ platform: string; external_id: string | null }> = sourcesResp.ok ? await sourcesResp.json() : []
    const accountByPlatform = new Map(sourceRows.map((s) => [s.platform, s.external_id?.trim() ?? '']))

    const paidRowsBySource = await Promise.all(
      PAID_SOURCES.map(async (source) => {
        const accountId = accountByPlatform.get(source.dataSourcePlatform) ?? ''
        if (!accountId) return [] as Array<{ date: string; cost: string | number; conversions: string | number; conversions_value: string | number }>
        const query = new URLSearchParams({ client_id: `eq.${client.id}`, order: 'date.asc' })
        query.set(source.accountColumn, `eq.${accountId}`)
        dateFilters(query)
        return fetchAllRows<{ date: string; cost: string | number; conversions: string | number; conversions_value: string | number }>(
          `${SUPABASE_URL}/rest/v1/${source.table}?${query.toString()}`,
          headers,
          source.table,
        )
      }),
    )

    const paidByDate = new Map<string, { inversion: number; conversiones: number; conversionesValue: number }>()
    for (const rows of paidRowsBySource) {
      for (const r of rows) {
        const day = paidByDate.get(r.date) ?? { inversion: 0, conversiones: 0, conversionesValue: 0 }
        day.inversion += Number(r.cost)
        day.conversiones += Number(r.conversions)
        day.conversionesValue += Number(r.conversions_value)
        paidByDate.set(r.date, day)
      }
    }
    const paidDates = Array.from(paidByDate.keys()).sort()
    const paidTotals = paidDates.reduce(
      (acc, d) => {
        const v = paidByDate.get(d)!
        acc.inversion += v.inversion
        acc.conversiones += v.conversiones
        acc.conversionesValue += v.conversionesValue
        return acc
      },
      { inversion: 0, conversiones: 0, conversionesValue: 0 },
    )
    const paidRoas = paidTotals.inversion ? paidTotals.conversionesValue / paidTotals.inversion : 0

    // --- SEO: ga4_daily, si GA4 está conectado ---
    const ga4SourceResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=eq.ga4&select=external_id`,
      { headers },
    )
    const [ga4Source] = ga4SourceResp.ok ? ((await ga4SourceResp.json()) as Array<{ external_id: string | null }>) : []
    const ga4PropertyId = ga4Source?.external_id?.trim() ?? ''

    const seoByDate = new Map<string, number>()
    if (ga4PropertyId) {
      const query = new URLSearchParams({ client_id: `eq.${client.id}`, property_id: `eq.${ga4PropertyId}`, order: 'date.asc' })
      dateFilters(query)
      const rows = await fetchAllRows<{ date: string; sessions: string | number }>(
        `${SUPABASE_URL}/rest/v1/ga4_daily?${query.toString()}`,
        headers,
        'ga4_daily',
      )
      for (const r of rows) {
        seoByDate.set(r.date, (seoByDate.get(r.date) ?? 0) + Number(r.sessions))
      }
    }
    const seoDates = Array.from(seoByDate.keys()).sort()
    const seoTotalSessions = seoDates.reduce((s, d) => s + (seoByDate.get(d) ?? 0), 0)

    // --- Serie de evolución de Paid Media (inversión vs conversiones) ---
    const globalPerformance = paidDates.map((date) => ({
      date: formatDateLabel(date),
      inversion: round2(paidByDate.get(date)!.inversion),
      conversiones: round2(paidByDate.get(date)!.conversiones),
    }))

    const summary = [
      {
        key: 'paid' as const,
        title: 'Paid Media',
        value: `${formatEuro(paidTotals.inversion)}`,
        sparkline: paidDates.map((d) => round2(paidByDate.get(d)!.inversion)),
        footer: `Conversiones: ${Math.round(paidTotals.conversiones)} · ROAS: ${paidRoas.toFixed(1)}x`,
      },
      {
        key: 'seo' as const,
        title: 'SEO',
        value: `${Math.round(seoTotalSessions)} sesiones`,
        sparkline: seoDates.map((d) => seoByDate.get(d) ?? 0),
        footer: ga4PropertyId ? 'Datos de Google Analytics 4' : 'GA4 no conectado todavía',
      },
      {
        key: 'social' as const,
        title: 'Redes Sociales',
        value: 'Sin datos todavía',
        sparkline: [],
        footer: 'Ninguna red social conectada todavía',
      },
    ]

    res.status(200).json({ summary, globalPerformance })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer el resumen desde Supabase.' })
  }
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
