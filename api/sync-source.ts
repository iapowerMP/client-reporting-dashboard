/**
 * Vercel Function: POST /api/sync-source
 * Body: { client: slug, platform }
 * Fuerza una sincronización inmediata de una fuente de datos concreta,
 * llamando al webhook de n8n correspondiente (en vez de esperar a la
 * ingesta programada). Google Ads y Meta Ads tienen integración real.
 *
 * Si el cliente tiene contraseña activada, exige el token de sesión
 * (Authorization: Bearer <token>, emitido por /api/verify-access).
 */
import { timingSafeEqual, createHmac } from 'crypto'

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

function checkAccess(req: any, client: { access_password_hash: string | null }, slug: string): boolean {
  if (!client.access_password_hash) return true
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secret = process.env.AUTH_TOKEN_SECRET
  return !!secret && !!token && verifyToken(token, slug, secret)
}

/** Webhook de n8n por plataforma. */
const SYNC_WEBHOOKS: Record<string, string | undefined> = {
  'google-ads': process.env.N8N_GADS_SYNC_WEBHOOK_URL,
  'meta-ads': process.env.N8N_META_SYNC_WEBHOOK_URL,
  ga4: process.env.N8N_GA4_SYNC_WEBHOOK_URL,
  gsc: process.env.N8N_GSC_SYNC_WEBHOOK_URL,
  facebook: process.env.N8N_FACEBOOK_SYNC_WEBHOOK_URL,
  instagram: process.env.N8N_INSTAGRAM_SYNC_WEBHOOK_URL,
  youtube: process.env.N8N_YOUTUBE_SYNC_WEBHOOK_URL,
}

/** Webhooks adicionales que se disparan junto al de su plataforma (mismo
 * botón "Sincronizar ahora"), sin bloquear la respuesta si fallan. Meta Ads
 * trae, además de las campañas, las creatividades a nivel de anuncio. */
const EXTRA_SYNC_WEBHOOKS: Record<string, string | undefined> = {
  'meta-ads': process.env.N8N_META_CREATIVES_SYNC_WEBHOOK_URL,
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/sync-source: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
    })
    return
  }

  const { client: slug, platform } = req.body ?? {}
  if (!slug || !platform) {
    res.status(400).json({ error: 'Faltan campos: client y platform son obligatorios.' })
    return
  }

  const webhookUrl = SYNC_WEBHOOKS[platform]
  if (!webhookUrl) {
    res.status(400).json({ error: 'Esta integración todavía no admite sincronización manual.' })
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

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  }
  const sourceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&platform=eq.${encodeURIComponent(platform)}&select=external_id`,
    { headers },
  )
  if (!sourceResp.ok) {
    res.status(502).json({ error: `Supabase respondió ${sourceResp.status} al leer data_sources.` })
    return
  }
  const [source] = (await sourceResp.json()) as Array<{ external_id: string | null }>
  const accountId = source?.external_id?.trim()
  if (!accountId) {
    res.status(400).json({ error: 'Guarda primero el identificador de la cuenta antes de sincronizar.' })
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    // Se envía bajo varios nombres porque cada workflow de n8n (uno por
    // plataforma) espera su propia clave (customerId, adAccountId, propertyId...).
    const triggerResp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: client.id, customerId: accountId, adAccountId: accountId, propertyId: accountId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!triggerResp.ok) {
      res.status(502).json({ error: `n8n respondió ${triggerResp.status} al iniciar la sincronización.` })
      return
    }

    // Best-effort: si esta plataforma tiene un webhook adicional (p. ej.
    // creatividades de Meta Ads), se dispara también, sin bloquear la
    // respuesta si falla o no está configurado.
    const extraWebhookUrl = EXTRA_SYNC_WEBHOOKS[platform]
    if (extraWebhookUrl) {
      fetch(extraWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id, customerId: accountId, adAccountId: accountId }),
      }).catch(() => {})
    }

    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'No se pudo contactar con n8n para iniciar la sincronización.' })
  }
}
