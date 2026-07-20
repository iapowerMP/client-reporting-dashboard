/**
 * Vercel Function: GET /api/social?client=<slug>&from&to
 * Lee las métricas diarias de Facebook (facebook_page_daily), Instagram
 * (instagram_daily) y YouTube (youtube_daily) y las agrega en la forma que
 * espera SocialData (src/services/types.ts). TikTok todavía no tiene
 * integración real.
 *
 * Simplificación actual (V1): cada tabla solo guarda snapshots a nivel de
 * página/canal (sin desglose por publicación), así que "engagement" (likes/
 * comments/shares) y "publicaciones destacadas" se devuelven vacíos con
 * honestidad — no hay de dónde sacarlos todavía. "Alcance" solo existe para
 * Instagram (reach); Facebook e YouTube no exponen ese dato con los scopes
 * de solo lectura usados aquí.
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

function formatPercent(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`
}

const round2 = (n: number) => Math.round(n * 100) / 100

type SocialTabName = 'Instagram' | 'Facebook' | 'TikTok' | 'YouTube'

const SOCIAL_COLORS: Record<SocialTabName, string> = {
  Instagram: '#E1306C',
  Facebook: '#1877F2',
  TikTok: '#FF004F',
  YouTube: '#FF0000',
}

interface FacebookRow {
  date: string
  followers: string | number
  impressions: string | number
  engaged_users: string | number
}

interface InstagramRow {
  date: string
  followers: string | number
  impressions: string | number
  reach: string | number
}

interface YoutubeRow {
  date: string
  subscribers: string | number
  views: string | number
  video_count: string | number
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/social: ${(e as Error).message}` })
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
    const sourcesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=in.(facebook,instagram,youtube)&select=platform,external_id`,
      { headers },
    )
    const sourceRows: Array<{ platform: string; external_id: string | null }> = sourcesResp.ok ? await sourcesResp.json() : []
    const accountByPlatform = new Map(sourceRows.map((s) => [s.platform, s.external_id?.trim() ?? '']))

    const facebookPageId = accountByPlatform.get('facebook') ?? ''
    const instagramId = accountByPlatform.get('instagram') ?? ''
    const youtubeChannelId = accountByPlatform.get('youtube') ?? ''

    const [facebookRows, instagramRows, youtubeRows] = await Promise.all([
      fetchDaily<FacebookRow>(SUPABASE_URL, headers, 'facebook_page_daily', 'page_id', facebookPageId, client.id, dateFilters),
      fetchDaily<InstagramRow>(SUPABASE_URL, headers, 'instagram_daily', 'ig_user_id', instagramId, client.id, dateFilters),
      fetchDaily<YoutubeRow>(SUPABASE_URL, headers, 'youtube_daily', 'channel_id', youtubeChannelId, client.id, dateFilters),
    ])

    const stats: Array<{
      platform: SocialTabName
      seguidores: number
      crecimientoNeto: number
      alcance: number
      impresiones: number
      engagementRate: number
      publicaciones: number
    }> = []

    if (facebookRows.length) {
      const impresiones = facebookRows.reduce((s, r) => s + Number(r.impressions), 0)
      const engaged = facebookRows.reduce((s, r) => s + Number(r.engaged_users), 0)
      stats.push({
        platform: 'Facebook',
        seguidores: Number(facebookRows[facebookRows.length - 1].followers),
        crecimientoNeto: Number(facebookRows[facebookRows.length - 1].followers) - Number(facebookRows[0].followers),
        alcance: 0,
        impresiones,
        engagementRate: impresiones ? round2((engaged / impresiones) * 100) : 0,
        publicaciones: 0,
      })
    }

    if (instagramRows.length) {
      stats.push({
        platform: 'Instagram',
        seguidores: Number(instagramRows[instagramRows.length - 1].followers),
        crecimientoNeto: Number(instagramRows[instagramRows.length - 1].followers) - Number(instagramRows[0].followers),
        alcance: instagramRows.reduce((s, r) => s + Number(r.reach), 0),
        impresiones: instagramRows.reduce((s, r) => s + Number(r.impressions), 0),
        engagementRate: 0,
        publicaciones: 0,
      })
    }

    if (youtubeRows.length) {
      const viewsDelta = Math.max(0, Number(youtubeRows[youtubeRows.length - 1].views) - Number(youtubeRows[0].views))
      const videosDelta = Math.max(0, Number(youtubeRows[youtubeRows.length - 1].video_count) - Number(youtubeRows[0].video_count))
      stats.push({
        platform: 'YouTube',
        seguidores: Number(youtubeRows[youtubeRows.length - 1].subscribers),
        crecimientoNeto: Number(youtubeRows[youtubeRows.length - 1].subscribers) - Number(youtubeRows[0].subscribers),
        alcance: 0,
        impresiones: viewsDelta,
        engagementRate: 0,
        publicaciones: videosDelta,
      })
    }

    // --- Evolución de seguidores (serie combinada, TikTok siempre en 0) ---
    const followersByDate = new Map<string, { Instagram: number; Facebook: number; TikTok: number; YouTube: number }>()
    const ensureDate = (date: string) => {
      const label = formatDateLabel(date)
      if (!followersByDate.has(label)) followersByDate.set(label, { Instagram: 0, Facebook: 0, TikTok: 0, YouTube: 0 })
      return followersByDate.get(label)!
    }
    for (const r of facebookRows) ensureDate(r.date).Facebook = Number(r.followers)
    for (const r of instagramRows) ensureDate(r.date).Instagram = Number(r.followers)
    for (const r of youtubeRows) ensureDate(r.date).YouTube = Number(r.subscribers)
    const allDates = Array.from(
      new Set([...facebookRows.map((r) => r.date), ...instagramRows.map((r) => r.date), ...youtubeRows.map((r) => r.date)]),
    ).sort()
    const followers = allDates.map((date) => ({ date: formatDateLabel(date), ...followersByDate.get(formatDateLabel(date))! }))

    // --- Alcance por plataforma (donut) — solo Instagram lo reporta hoy ---
    const totalAlcance = stats.reduce((s, x) => s + x.alcance, 0)
    const reach = stats.map((s) => ({
      name: s.platform,
      value: s.alcance,
      percent: totalAlcance ? formatPercent((s.alcance / totalAlcance) * 100) : '0,0%',
      color: SOCIAL_COLORS[s.platform],
    }))

    res.status(200).json({
      stats: stats.map((s) => ({
        platform: s.platform,
        seguidores: s.seguidores,
        crecimientoNeto: s.crecimientoNeto,
        alcance: s.alcance,
        impresiones: s.impresiones,
        engagementRate: s.engagementRate,
        publicaciones: s.publicaciones,
      })),
      followers,
      // Sin datos de likes/comments/shares ni de publicaciones individuales
      // todavía: estado vacío honesto en vez de cifras inventadas.
      engagement: [],
      reach,
      posts: [],
    })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo leer Redes Sociales desde Supabase.' })
  }
}

async function fetchDaily<T>(
  supabaseUrl: string,
  headers: Record<string, string>,
  table: string,
  accountColumn: string,
  accountId: string,
  clientId: string,
  dateFilters: (query: URLSearchParams) => void,
): Promise<T[]> {
  if (!accountId) return []
  const query = new URLSearchParams({ client_id: `eq.${clientId}`, order: 'date.asc' })
  query.set(accountColumn, `eq.${accountId}`)
  dateFilters(query)
  const resp = await fetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, { headers })
  if (!resp.ok) throw new Error(`Supabase respondió ${resp.status} al consultar ${table}.`)
  return (await resp.json()) as T[]
}
