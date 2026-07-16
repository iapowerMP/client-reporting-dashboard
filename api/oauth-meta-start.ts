/**
 * Vercel Function: GET /api/oauth-meta-start?client=<slug>&token=<sesión opcional>
 * Primer paso del "Conectar con Facebook" de Meta Ads: redirige al diálogo de
 * OAuth de Facebook. A diferencia del modo API (System User compartido, solo
 * ve cuentas compartidas con nuestro Business Manager), aquí es el propio
 * project manager/cliente quien inicia sesión y concede acceso a las cuentas
 * publicitarias que ÉL administra — sin límite de partners de BM.
 *
 * Esta es una navegación de página completa (no un fetch), así que el token
 * de sesión (si el informe tiene contraseña) viaja como query param en vez de
 * cabecera Authorization; tiene la misma vida útil y validación que el que ya
 * se guarda en localStorage, no es más sensible.
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
    res.status(500).send(`Error inesperado en /api/oauth-meta-start: ${(e as Error).message}`)
  }
}

async function handleRequest(req: any, res: any) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET, META_APP_ID, META_OAUTH_REDIRECT_URI } =
    process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_TOKEN_SECRET) {
    res.status(500).send('Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET).')
    return
  }
  if (!META_APP_ID || !META_OAUTH_REDIRECT_URI) {
    res.status(500).send('Faltan variables de entorno en el servidor (META_APP_ID, META_OAUTH_REDIRECT_URI).')
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
    client_id: META_APP_ID,
    redirect_uri: META_OAUTH_REDIRECT_URI,
    state,
    scope: 'ads_read',
    response_type: 'code',
  })
  res.writeHead(302, { Location: `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}` })
  res.end()
}
