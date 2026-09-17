/**
 * Vercel Function: /api/oauth-tiktok?service=ads|organic&action=start|callback|accounts|finalize
 * Flujo de "iniciar sesión con TikTok", compartido por las DOS integraciones
 * de TikTok — que en realidad son dos apps de TikTok completamente
 * independientes, con sus propias credenciales y su propio protocolo:
 *
 *   - service=ads     → TikTok Business API / Marketing API
 *     (business-api.tiktok.com). App creada en el portal de TikTok for
 *     Business. Usa TIKTOK_ADS_APP_ID / TIKTOK_ADS_APP_SECRET /
 *     TIKTOK_ADS_REDIRECT_URI. El callback llega con `?auth_code=` (no
 *     `?code=`), el canje de token es un POST JSON que devuelve
 *     {code, message, data: {access_token, advertiser_ids, scope}} (0 =
 *     éxito), y el access_token NO caduca por sí solo (no hay refresh_token
 *     — sigue siendo válido hasta que el anunciante revoque el acceso).
 *   - service=organic → TikTok Login Kit (developers.tiktok.com), OAuth2
 *     estándar. Usa TIKTOK_LOGIN_CLIENT_KEY / TIKTOK_LOGIN_CLIENT_SECRET /
 *     TIKTOK_LOGIN_REDIRECT_URI. El callback llega con `?code=`, el canje de
 *     token es un POST x-www-form-urlencoded a open.tiktokapis.com que
 *     devuelve {access_token, expires_in (~24h), refresh_token,
 *     refresh_expires_in, open_id, scope} — sí hay refresh_token de verdad,
 *     el access_token es de corta duración y hay que renovarlo (eso lo hará
 *     el workflow de n8n de ingesta con el refresh_token guardado, no este
 *     fichero).
 *
 * Un único fichero, mismo motivo que oauth-google.ts / oauth-facebook.ts:
 * límite de Serverless Functions del plan de Vercel.
 *
 *   - action=start     (GET)  Redirige al diálogo de OAuth correspondiente.
 *   - action=callback   (GET)  TikTok redirige aquí. Canjea el código por el
 *     token y lo guarda en una cookie firmada httpOnly de corta vida
 *     (distinta por servicio) mientras el usuario elige la cuenta.
 *   - action=accounts   (GET)  Lista las cuentas accesibles con ese token
 *     (para 'ads', los advertiser_ids del propio canje; para 'organic',
 *     solo la cuenta de TikTok que acaba de autorizar — no hay selección).
 *   - action=finalize   (POST) Guarda en data_sources la cuenta elegida.
 *
 * Importante: cada app de TikTok tiene su PROPIO campo de "Redirect URI" en
 * su portal — hay que registrar ahí exactamente
 * ".../api/oauth-tiktok?action=callback&service=ads" en la app de Ads y
 * ".../api/oauth-tiktok?action=callback&service=organic" en la de Login Kit
 * (a diferencia de Google/Meta, aquí el `service` SÍ va literal en la URL
 * registrada, porque son dos apps distintas con dos campos de redirect URI
 * distintos — el `state` sigue llevando el `service` firmado igualmente,
 * por coherencia con el resto del código y como defensa en profundidad).
 *
 * Aviso: los detalles exactos de la API de TikTok Business (nombres de
 * parámetros, forma de la respuesta) se han escrito de memoria porque
 * business-api.tiktok.com no es accesible para consultar la documentación
 * desde este entorno — conviene probar el flujo completo con una cuenta de
 * pruebas antes de darlo por bueno en producción.
 */
import { timingSafeEqual, createHmac } from 'crypto'

type TikTokService = 'ads' | 'organic'

const STATE_TTL_MS = 10 * 60 * 1000
const PENDING_TTL_S = 10 * 60
// user.info.stats aporta follower_count/video_count (imprescindible para la
// serie de "Evolución de seguidores" comparada con Instagram/Facebook/
// YouTube en el apartado Social) — user.info.basic por sí solo no lo trae.
const ORGANIC_SCOPE = 'user.info.basic,user.info.stats,video.list'

function isTikTokService(value: unknown): value is TikTokService {
  return value === 'ads' || value === 'organic'
}

function pendingCookieName(service: TikTokService): string {
  return `mp_tiktok_oauth_pending_${service}`
}

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

/** Comprueba que `token` (bearer, o el ?token= de un GET de navegador que
 * no puede mandar cabeceras) pertenece a un usuario con acceso a este
 * cliente (admin: acceso implícito a todos). */
async function checkAccess(
  token: string,
  clientId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  secret: string,
): Promise<boolean> {
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

function signState(slug: string, service: TikTokService, secret: string): string {
  const expiry = Date.now() + STATE_TTL_MS
  const sig = createHmac('sha256', secret).update(`oauth-state:${slug}:${service}:${expiry}`).digest('hex')
  return Buffer.from(`${slug}.${service}.${expiry}.${sig}`).toString('base64url')
}

function verifyState(state: string, secret: string): { slug: string; service: TikTokService } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [slug, service, expiryStr, sig] = decoded.split('.')
    const expiry = Number(expiryStr)
    if (!slug || !isTikTokService(service) || !expiry || !sig || Date.now() > expiry) return null
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

interface PendingSession {
  slug: string
  accessToken: string
  refreshToken?: string
  advertiserIds?: string[]
  exp: number
}

function signPendingCookie(payload: PendingSession, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  return `${json}.${sig}`
}

function readPendingSession(cookieValue: string, slug: string, secret: string): PendingSession | null {
  const [json, sig] = cookieValue.split('.')
  if (!json || !sig) return null
  const expected = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as PendingSession
    if (payload.slug !== slug || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

function reportOrigin(): string {
  return process.env.PUBLIC_APP_URL || 'https://client-reporting-dashboard-orpin.vercel.app'
}

function htmlError(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#e5e5e5;background:#0b0b0c">
    <h3>No se pudo completar la conexión con TikTok</h3>
    <p>${message}</p>
  </body></html>`
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, must-revalidate')

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
    res.status(500).json({ error: `Error inesperado en /api/oauth-tiktok: ${(e as Error).message}` })
  }
}

/** action=start — GET ?service=ads|organic&client=<slug>&token=<sesión opcional> */
async function handleStart(req: any, res: any) {
  const service = req.query?.service
  if (!isTikTokService(service)) {
    res.status(400).send('Falta o es inválido el parámetro service (ads | organic).')
    return
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_TOKEN_SECRET) {
    res.status(500).send('Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET).')
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
  const startToken = typeof req.query?.token === 'string' ? req.query.token : ''
  if (!(await checkAccess(startToken, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) {
    res.status(401).send('No tienes acceso a este informe. Inicia sesión de nuevo.')
    return
  }

  const state = signState(slug, service, AUTH_TOKEN_SECRET)

  if (service === 'ads') {
    const { TIKTOK_ADS_APP_ID, TIKTOK_ADS_REDIRECT_URI } = process.env
    if (!TIKTOK_ADS_APP_ID || !TIKTOK_ADS_REDIRECT_URI) {
      res.status(500).send('Faltan variables de entorno en el servidor (TIKTOK_ADS_APP_ID, TIKTOK_ADS_REDIRECT_URI).')
      return
    }
    const params = new URLSearchParams({ app_id: TIKTOK_ADS_APP_ID, state, redirect_uri: TIKTOK_ADS_REDIRECT_URI })
    res.writeHead(302, { Location: `https://business-api.tiktok.com/portal/auth?${params.toString()}` })
    res.end()
    return
  }

  // service === 'organic'
  const { TIKTOK_LOGIN_CLIENT_KEY, TIKTOK_LOGIN_REDIRECT_URI } = process.env
  if (!TIKTOK_LOGIN_CLIENT_KEY || !TIKTOK_LOGIN_REDIRECT_URI) {
    res.status(500).send('Faltan variables de entorno en el servidor (TIKTOK_LOGIN_CLIENT_KEY, TIKTOK_LOGIN_REDIRECT_URI).')
    return
  }
  const params = new URLSearchParams({
    client_key: TIKTOK_LOGIN_CLIENT_KEY,
    scope: ORGANIC_SCOPE,
    response_type: 'code',
    redirect_uri: TIKTOK_LOGIN_REDIRECT_URI,
    state,
  })
  res.writeHead(302, { Location: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` })
  res.end()
}

/** action=callback — GET, redirigido por TikTok. 'ads' manda ?auth_code=,
 * 'organic' manda ?code= (OAuth2 estándar) — ambos junto a &state=. */
async function handleCallback(req: any, res: any) {
  const { AUTH_TOKEN_SECRET } = process.env
  if (!AUTH_TOKEN_SECRET) {
    res.status(500).send(htmlError('Falta la variable de entorno AUTH_TOKEN_SECRET.'))
    return
  }

  const stateParam = typeof req.query?.state === 'string' ? req.query.state : ''
  const state = verifyState(stateParam, AUTH_TOKEN_SECRET)
  if (!state) {
    res.status(400).send(htmlError('El enlace ha caducado o no es válido. Vuelve a intentarlo desde Configuración.'))
    return
  }

  const errorParam =
    (typeof req.query?.error === 'string' && req.query.error) ||
    (typeof req.query?.error_description === 'string' && req.query.error_description) ||
    ''
  if (errorParam) {
    res.status(400).send(htmlError(`TikTok denegó la solicitud: ${errorParam}`))
    return
  }

  try {
    if (state.service === 'ads') {
      const { TIKTOK_ADS_APP_ID, TIKTOK_ADS_APP_SECRET } = process.env
      if (!TIKTOK_ADS_APP_ID || !TIKTOK_ADS_APP_SECRET) {
        throw new Error('Faltan variables de entorno en el servidor (TIKTOK_ADS_APP_ID, TIKTOK_ADS_APP_SECRET).')
      }
      const authCode = typeof req.query?.auth_code === 'string' ? req.query.auth_code : ''
      if (!authCode) throw new Error('TikTok no devolvió auth_code.')

      const tokenResp = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: TIKTOK_ADS_APP_ID, secret: TIKTOK_ADS_APP_SECRET, auth_code: authCode }),
      })
      const tokenBody = (await tokenResp.json()) as {
        code?: number
        message?: string
        data?: { access_token?: string; advertiser_ids?: string[] }
      }
      if (!tokenResp.ok || tokenBody.code !== 0 || !tokenBody.data?.access_token) {
        throw new Error(tokenBody.message || `TikTok respondió ${tokenResp.status} al canjear el auth_code.`)
      }

      const exp = Date.now() + PENDING_TTL_S * 1000
      const cookieValue = signPendingCookie(
        {
          slug: state.slug,
          accessToken: tokenBody.data.access_token,
          advertiserIds: tokenBody.data.advertiser_ids ?? [],
          exp,
        },
        AUTH_TOKEN_SECRET,
      )
      res.setHeader(
        'Set-Cookie',
        `${pendingCookieName('ads')}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-tiktok; HttpOnly; Secure; SameSite=Lax`,
      )
      res.writeHead(302, { Location: `${reportOrigin()}/${state.slug}/settings?tiktok_oauth=ads` })
      res.end()
      return
    }

    // service === 'organic'
    const { TIKTOK_LOGIN_CLIENT_KEY, TIKTOK_LOGIN_CLIENT_SECRET, TIKTOK_LOGIN_REDIRECT_URI } = process.env
    if (!TIKTOK_LOGIN_CLIENT_KEY || !TIKTOK_LOGIN_CLIENT_SECRET || !TIKTOK_LOGIN_REDIRECT_URI) {
      throw new Error(
        'Faltan variables de entorno en el servidor (TIKTOK_LOGIN_CLIENT_KEY, TIKTOK_LOGIN_CLIENT_SECRET, TIKTOK_LOGIN_REDIRECT_URI).',
      )
    }
    const code = typeof req.query?.code === 'string' ? req.query.code : ''
    if (!code) throw new Error('TikTok no devolvió code.')

    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: TIKTOK_LOGIN_CLIENT_KEY,
        client_secret: TIKTOK_LOGIN_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_LOGIN_REDIRECT_URI,
      }).toString(),
    })
    const tokenBody = (await tokenResp.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (!tokenResp.ok || !tokenBody.access_token) {
      throw new Error(tokenBody.error_description || tokenBody.error || `TikTok respondió ${tokenResp.status} al canjear el code.`)
    }
    if (!tokenBody.refresh_token) {
      throw new Error('TikTok no devolvió un refresh_token. Revoca el acceso previo desde la cuenta de TikTok y vuelve a intentarlo.')
    }

    const exp = Date.now() + PENDING_TTL_S * 1000
    const cookieValue = signPendingCookie(
      { slug: state.slug, accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token, exp },
      AUTH_TOKEN_SECRET,
    )
    res.setHeader(
      'Set-Cookie',
      `${pendingCookieName('organic')}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-tiktok; HttpOnly; Secure; SameSite=Lax`,
    )
    res.writeHead(302, { Location: `${reportOrigin()}/${state.slug}/settings?tiktok_oauth=organic` })
    res.end()
  } catch (e) {
    res.status(502).send(htmlError((e as Error).message))
  }
}

/** action=accounts — GET ?service=ads|organic&client=<slug> */
async function handleAccounts(req: any, res: any) {
  const service = req.query?.service
  if (!isTikTokService(service)) {
    res.status(400).json({ error: 'Falta o es inválido el parámetro service (ads | organic).' })
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
  const cookieName = pendingCookieName(service)
  const session = cookies[cookieName] ? readPendingSession(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
  if (!session) {
    res.status(401).json({ error: 'La sesión de conexión con TikTok ha caducado. Vuelve a pulsar "Conectar con TikTok".' })
    return
  }

  try {
    if (service === 'ads') {
      const { TIKTOK_ADS_APP_ID } = process.env
      const advertiserIds = session.advertiserIds ?? []
      if (!TIKTOK_ADS_APP_ID || advertiserIds.length === 0) {
        res.status(200).json({ accounts: [] })
        return
      }
      const resp = await fetch(
        `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?${new URLSearchParams({
          advertiser_ids: JSON.stringify(advertiserIds),
        }).toString()}`,
        { headers: { 'Access-Token': session.accessToken } },
      )
      const body = (await resp.json()) as {
        code?: number
        message?: string
        data?: { list?: Array<{ advertiser_id: string; name: string }> }
      }
      if (!resp.ok || body.code !== 0) throw new Error(body.message || `TikTok respondió ${resp.status}.`)
      const accounts = (body.data?.list ?? []).map((a) => ({ id: a.advertiser_id, name: a.name }))
      res.status(200).json({ accounts })
      return
    }

    // service === 'organic': una única cuenta, la que se acaba de autorizar.
    const resp = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const body = (await resp.json()) as {
      data?: { user?: { open_id: string; display_name: string } }
      error?: { code: string; message: string }
    }
    if (!resp.ok || !body.data?.user) throw new Error(body.error?.message || `TikTok respondió ${resp.status}.`)
    res.status(200).json({ accounts: [{ id: body.data.user.open_id, name: body.data.user.display_name }] })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudieron listar las cuentas de TikTok.' })
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
  if (!slug || !isTikTokService(service) || !accountId) {
    res.status(400).json({ error: 'Faltan campos: client, service y accountId son obligatorios.' })
    return
  }

  const client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  if (!client) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }
  const finalizeAuthHeader = req.headers?.authorization ?? ''
  const finalizeToken = finalizeAuthHeader.startsWith('Bearer ') ? finalizeAuthHeader.slice(7) : ''
  if (!(await checkAccess(finalizeToken, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) {
    res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
    return
  }

  const cookies = parseCookies(req.headers?.cookie)
  const cookieName = pendingCookieName(service)
  const session = cookies[cookieName] ? readPendingSession(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
  if (!session) {
    res.status(401).json({ error: 'La sesión de conexión con TikTok ha caducado. Vuelve a pulsar "Conectar con TikTok".' })
    return
  }

  try {
    const platform = service === 'ads' ? 'tiktok-ads' : 'tiktok-org'
    const row: Record<string, unknown> = {
      client_id: client.id,
      platform,
      external_id: accountId,
      status: 'conectado',
      auth_method: 'oauth',
      oauth_access_token: session.accessToken,
    }
    // 'ads' no tiene refresh_token (el access_token de TikTok Business no
    // caduca por sí solo); 'organic' sí, y su access_token dura ~24h.
    if (service === 'organic' && session.refreshToken) {
      row.oauth_refresh_token = session.refreshToken
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/data_sources?on_conflict=client_id,platform`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([row]),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al guardar data_sources.` })
      return
    }
    res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; Path=/api/oauth-tiktok; HttpOnly; Secure; SameSite=Lax`)
    const [savedRow] = await resp.json()
    res.status(200).json({ source: savedRow })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo guardar en Supabase.' })
  }
}
