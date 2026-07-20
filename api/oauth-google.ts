/**
 * Vercel Function: /api/oauth-google?service=ga4|gsc|youtube&action=start|callback|accounts|finalize
 * Flujo de "iniciar sesión con Google", compartido por todas las
 * integraciones de Google (GA4, Search Console, YouTube, y las que se
 * añadan más adelante) en un solo archivo — para no superar el límite de
 * Serverless Functions del plan de Vercel. Todas reutilizan el mismo
 * cliente OAuth de Google Cloud (GOOGLE_OAUTH_CLIENT_ID/SECRET), cada una
 * con su propio scope de solo lectura.
 *
 *   - action=start     (GET)  Redirige al diálogo de OAuth de Google con el
 *     scope de `service`. access_type=offline + prompt=consent fuerzan a que
 *     Google devuelva un refresh_token también en re-conexiones.
 *   - action=callback   (GET)  Google redirige aquí con ?code&state (el
 *     `service` viaja dentro de `state`, firmado, no como query param propio
 *     — así una única URL de redirección registrada sirve para todos los
 *     servicios). Canjea el code por un access_token (1h) y un refresh_token,
 *     guardados en una cookie firmada httpOnly de corta vida (distinta por
 *     servicio) mientras el usuario elige la cuenta en el paso siguiente.
 *   - action=accounts   (GET)  Lista las cuentas/propiedades de ESE servicio
 *     a las que la persona tiene acceso.
 *   - action=finalize   (POST) Guarda en data_sources la cuenta elegida junto
 *     con el refresh token de ESE usuario (auth_method = 'oauth').
 *
 * Importante: la URL de redirección registrada en el cliente OAuth de Google
 * Cloud y en la variable de entorno GOOGLE_OAUTH_REDIRECT_URI debe ser
 * ".../api/oauth-google?action=callback" (sin &service=, se recupera del
 * `state`).
 */
import { timingSafeEqual, createHmac } from 'crypto'

type GoogleService = 'ga4' | 'gsc' | 'youtube'

const SERVICE_CONFIG: Record<GoogleService, { scope: string; platform: string; pendingCookie: string }> = {
  ga4: {
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    platform: 'ga4',
    pendingCookie: 'mp_google_oauth_pending_ga4',
  },
  gsc: {
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    platform: 'gsc',
    pendingCookie: 'mp_google_oauth_pending_gsc',
  },
  youtube: {
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    platform: 'youtube',
    pendingCookie: 'mp_google_oauth_pending_youtube',
  },
}

const STATE_TTL_MS = 10 * 60 * 1000
const PENDING_TTL_S = 10 * 60

function isGoogleService(value: unknown): value is GoogleService {
  return value === 'ga4' || value === 'gsc' || value === 'youtube'
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

function signState(slug: string, service: GoogleService, secret: string): string {
  const expiry = Date.now() + STATE_TTL_MS
  const sig = createHmac('sha256', secret).update(`oauth-state:${slug}:${service}:${expiry}`).digest('hex')
  return Buffer.from(`${slug}.${service}.${expiry}.${sig}`).toString('base64url')
}

function verifyState(state: string, secret: string): { slug: string; service: GoogleService } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [slug, service, expiryStr, sig] = decoded.split('.')
    const expiry = Number(expiryStr)
    if (!slug || !isGoogleService(service) || !expiry || !sig || Date.now() > expiry) return null
    const expected = createHmac('sha256', secret).update(`oauth-state:${slug}:${service}:${expiry}`).digest('hex')
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    return { slug, service }
  } catch {
    return null
  }
}

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

function signPendingCookie(
  payload: { slug: string; accessToken: string; refreshToken: string; exp: number },
  secret: string,
): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  return `${json}.${sig}`
}

function readPendingSession(
  cookieValue: string,
  slug: string,
  secret: string,
): { accessToken: string; refreshToken: string } | null {
  const [json, sig] = cookieValue.split('.')
  if (!json || !sig) return null
  const expected = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as {
      slug: string
      accessToken: string
      refreshToken: string
      exp: number
    }
    if (payload.slug !== slug || Date.now() > payload.exp) return null
    return { accessToken: payload.accessToken, refreshToken: payload.refreshToken }
  } catch {
    return null
  }
}

function reportOrigin(): string {
  return process.env.PUBLIC_APP_URL || 'https://client-reporting-dashboard-orpin.vercel.app'
}

function htmlError(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#e5e5e5;background:#0b0b0c">
    <h3>No se pudo completar la conexión con Google</h3>
    <p>${message}</p>
  </body></html>`
}

export default async function handler(req: any, res: any) {
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  try {
    switch (action) {
      case 'start':
        return await handleStart(req, res)
      case 'callback':
        return await handleCallback(req, res)
      case 'accounts':
        return await handleAccounts(req, res)
      case 'finalize':
        return await handleFinalize(req, res)
      default:
        res.status(400).json({ error: 'Falta o es inválido el parámetro action.' })
    }
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/oauth-google: ${(e as Error).message}` })
  }
}

/** action=start — GET ?service=ga4|gsc&client=<slug>&token=<sesión opcional> */
async function handleStart(req: any, res: any) {
  const service = req.query?.service
  if (!isGoogleService(service)) {
    res.status(400).send('Falta o es inválido el parámetro service (ga4 | gsc | youtube).')
    return
  }

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

  const state = signState(slug, service, AUTH_TOKEN_SECRET)
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: SERVICE_CONFIG[service].scope,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
  res.end()
}

/** action=callback — GET, redirigido por Google con ?code&state */
async function handleCallback(req: any, res: any) {
  const { AUTH_TOKEN_SECRET, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = process.env
  if (!AUTH_TOKEN_SECRET || !GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) {
    res.status(500).send(htmlError('Faltan variables de entorno en el servidor (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, AUTH_TOKEN_SECRET).'))
    return
  }

  const errorParam = typeof req.query?.error === 'string' ? req.query.error : ''
  if (errorParam) {
    res.status(400).send(htmlError(`Google denegó la solicitud: ${errorParam}`))
    return
  }

  const code = typeof req.query?.code === 'string' ? req.query.code : ''
  const stateParam = typeof req.query?.state === 'string' ? req.query.state : ''
  const state = verifyState(stateParam, AUTH_TOKEN_SECRET)
  if (!code || !state) {
    res.status(400).send(htmlError('El enlace ha caducado o no es válido. Vuelve a intentarlo desde Configuración.'))
    return
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    })
    const tokenBody = (await tokenResp.json()) as {
      access_token?: string
      refresh_token?: string
      error_description?: string
      error?: string
    }
    if (!tokenResp.ok || !tokenBody.access_token) {
      throw new Error(tokenBody.error_description || tokenBody.error || `Google respondió ${tokenResp.status} al canjear el código.`)
    }
    if (!tokenBody.refresh_token) {
      throw new Error(
        'Google no devolvió un refresh token. Si ya habías conectado esta cuenta antes, revoca el acceso en myaccount.google.com/permissions y vuelve a intentarlo.',
      )
    }

    const exp = Date.now() + PENDING_TTL_S * 1000
    const cookieValue = signPendingCookie(
      { slug: state.slug, accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token, exp },
      AUTH_TOKEN_SECRET,
    )
    res.setHeader(
      'Set-Cookie',
      `${SERVICE_CONFIG[state.service].pendingCookie}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-google; HttpOnly; Secure; SameSite=Lax`,
    )
    res.writeHead(302, { Location: `${reportOrigin()}/c/${state.slug}/settings?google_oauth=${state.service}` })
    res.end()
  } catch (e) {
    res.status(502).send(htmlError((e as Error).message))
  }
}

/** action=accounts — GET ?service=ga4|gsc&client=<slug> */
async function handleAccounts(req: any, res: any) {
  const service = req.query?.service
  if (!isGoogleService(service)) {
    res.status(400).json({ error: 'Falta o es inválido el parámetro service (ga4 | gsc | youtube).' })
    return
  }

  const { AUTH_TOKEN_SECRET } = process.env
  if (!AUTH_TOKEN_SECRET) {
    res.status(500).json({ error: 'Falta la variable de entorno AUTH_TOKEN_SECRET.' })
    return
  }

  const slug = typeof req.query?.client === 'string' ? req.query.client : ''
  if (!slug) {
    res.status(400).json({ error: 'Falta el parámetro client en la petición.' })
    return
  }

  const cookies = parseCookies(req.headers?.cookie)
  const cookieName = SERVICE_CONFIG[service].pendingCookie
  const session = cookies[cookieName] ? readPendingSession(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
  if (!session) {
    res.status(401).json({ error: 'La sesión de conexión con Google ha caducado. Vuelve a pulsar "Conectar con Google".' })
    return
  }

  try {
    if (service === 'ga4') {
      const resp = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const body = (await resp.json()) as {
        accountSummaries?: Array<{
          displayName: string
          propertySummaries?: Array<{ property: string; displayName: string }>
        }>
        error?: { message: string }
      }
      if (!resp.ok) throw new Error(body.error?.message || `Google respondió ${resp.status}.`)
      const accounts = (body.accountSummaries ?? []).flatMap((acc) =>
        (acc.propertySummaries ?? []).map((p) => ({
          id: p.property, // "properties/XXXXXXXXX"
          name: `${p.displayName} (${acc.displayName})`,
        })),
      )
      res.status(200).json({ accounts })
      return
    }

    if (service === 'gsc') {
      const resp = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      const body = (await resp.json()) as {
        siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>
        error?: { message: string }
      }
      if (!resp.ok) throw new Error(body.error?.message || `Google respondió ${resp.status}.`)
      const accounts = (body.siteEntry ?? [])
        .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
        .map((s) => ({ id: s.siteUrl, name: s.siteUrl }))
      res.status(200).json({ accounts })
      return
    }

    // service === 'youtube'
    const resp = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({ part: 'snippet', mine: 'true', maxResults: '50' }).toString()}`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } },
    )
    const body = (await resp.json()) as {
      items?: Array<{ id: string; snippet: { title: string } }>
      error?: { message: string }
    }
    if (!resp.ok) throw new Error(body.error?.message || `Google respondió ${resp.status}.`)
    const accounts = (body.items ?? []).map((c) => ({ id: c.id, name: c.snippet.title }))
    res.status(200).json({ accounts })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudieron listar las cuentas de Google.' })
  }
}

/** action=finalize — POST { client, service, accountId } */
async function handleFinalize(req: any, res: any) {
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

  const { client: slug, service, accountId } = req.body ?? {}
  if (!slug || !isGoogleService(service) || !accountId) {
    res.status(400).json({ error: 'Faltan campos: client, service y accountId son obligatorios.' })
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
  const cookieName = SERVICE_CONFIG[service].pendingCookie
  const session = cookies[cookieName] ? readPendingSession(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
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
          platform: SERVICE_CONFIG[service].platform,
          external_id: accountId,
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
    res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; Path=/api/oauth-google; HttpOnly; Secure; SameSite=Lax`)
    const [row] = await resp.json()
    res.status(200).json({ source: row })
  } catch {
    res.status(502).json({ error: 'No se pudo guardar en Supabase.' })
  }
}
