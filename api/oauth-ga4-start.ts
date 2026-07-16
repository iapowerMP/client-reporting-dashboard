/**
 * Vercel Function: GET /api/oauth-ga4-start?client=<slug>&token=<sesión opcional>
 * Primer paso del "Conectar con Google" de GA4 (única forma de conectar esta
 * integración: no hay modo API manual). Redirige al diálogo de OAuth de
 * Google; el propio project manager/cliente inicia sesión y concede acceso
 * de solo lectura a las propiedades GA4 que él mismo administra.
 *
 * access_type=offline + prompt=consent fuerzan a que Google devuelva un
 * refresh_token también en re-conexiones (si no, solo lo da la primera vez).
 *
 * Navegación de página completa (no fetch): el token de sesión (si el
 * informe tiene contraseña) viaja como query param, igual que en
 * /api/oauth-meta-start.
 */
import { timingSafeEqual, createHmac } from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

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

function signState(slug: string, secret: string): string {
  const expiry = Date.now() + STATE_TTL_MS
  const sig = createHmac('sha256', secret).update(`oauth-state:${slug}:${expiry}`).digest('hex')
  return Buffer.from(`${slug}.${expiry}.${sig}`).toString('base64url')
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).send(`Error inesperado en /api/oauth-ga4-start: ${(e as Error).message}`)
  }
}

async function handleRequest(req: any, res: any) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI } =
    process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_TOKEN_SECRET) {
    res.status(500).send('Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET).')
    return
  }
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_REDIRECT_URI) {
    res.status(500).send('Faltan variables de entorno en el servidor (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI).')
    return
  }

  const slug = typeof req.query?.client === 'string' ? req.query.client : ''
  if (!slug) {
    res.status(400).send('Falta el parámetro client en la petición.')
    return
  }

  const client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  if (!client) {
    res.status(404).send(`No existe ningún cliente con el identificador "${slug}".`)
    return
  }
  if (client.access_password_hash) {
    const token = typeof req.query?.token === 'string' ? req.query.token : ''
    if (!token || !verifyToken(token, slug, AUTH_TOKEN_SECRET)) {
      res.status(401).send('Este informe está protegido con contraseña. Vuelve a introducirla.')
      return
    }
  }

  const state = signState(slug, AUTH_TOKEN_SECRET)
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
  res.end()
}
