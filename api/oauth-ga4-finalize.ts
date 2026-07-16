/**
 * Vercel Function: POST /api/oauth-ga4-finalize
 * Body: { client: slug, propertyId }
 * Último paso del "Conectar con Google" de GA4: guarda en data_sources la
 * propiedad elegida (de /api/oauth-ga4-accounts) junto con el refresh token
 * de ESE usuario (auth_method = 'oauth'), y limpia la cookie pendiente.
 */
import { timingSafeEqual, createHmac } from 'crypto'

const PENDING_COOKIE = 'mp_ga4_oauth_pending'

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return out
}

function readPendingSession(cookieValue: string, slug: string, secret: string): { refreshToken: string } | null {
  const [json, sig] = cookieValue.split('.')
  if (!json || !sig) return null
  const expected = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as {
      slug: string
      refreshToken: string
      exp: number
    }
    if (payload.slug !== slug || Date.now() > payload.exp) return null
    return { refreshToken: payload.refreshToken }
  } catch {
    return null
  }
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

function checkAccess(req: any, client: { access_password_hash: string | null }, slug: string, secret: string): boolean {
  if (!client.access_password_hash) return true
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  return !!token && verifyToken(token, slug, secret)
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/oauth-ga4-finalize: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_TOKEN_SECRET) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET).',
    })
    return
  }

  const { client: slug, propertyId } = req.body ?? {}
  if (!slug || !propertyId) {
    res.status(400).json({ error: 'Faltan campos: client y propertyId son obligatorios.' })
    return
  }

  const client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  if (!client) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }
  if (!checkAccess(req, client, slug, AUTH_TOKEN_SECRET)) {
    res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
    return
  }

  const cookies = parseCookies(req.headers?.cookie)
  const session = cookies[PENDING_COOKIE] ? readPendingSession(cookies[PENDING_COOKIE], slug, AUTH_TOKEN_SECRET) : null
  if (!session) {
    res.status(401).json({ error: 'La sesión de conexión con Google ha caducado. Vuelve a pulsar "Conectar con Google".' })
    return
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/data_sources?on_conflict=client_id,platform`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          client_id: client.id,
          platform: 'ga4',
          external_id: propertyId,
          status: 'conectado',
          auth_method: 'oauth',
          oauth_refresh_token: session.refreshToken,
        },
      ]),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al guardar data_sources.` })
      return
    }
    res.setHeader('Set-Cookie', `mp_ga4_oauth_pending=; Max-Age=0; Path=/api/oauth-ga4; HttpOnly; Secure; SameSite=Lax`)
    const [row] = await resp.json()
    res.status(200).json({ source: row })
  } catch {
    res.status(502).json({ error: 'No se pudo guardar en Supabase.' })
  }
}
