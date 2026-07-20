/**
 * Vercel Function: /api/oauth-facebook?service=ads|page|instagram&action=start|callback|accounts|finalize
 * Flujo de "iniciar sesión con Facebook", compartido por todas las
 * integraciones de Meta (Meta Ads, Página de Facebook, Instagram) en un solo
 * archivo — para no superar el límite de Serverless Functions del plan de
 * Vercel. Todas reutilizan la misma app de Meta (META_APP_ID/SECRET), cada
 * una con su propio scope de solo lectura.
 *
 *   - action=start     (GET)  Redirige al diálogo de OAuth de Facebook con
 *     el scope de `service`.
 *   - action=callback   (GET)  Facebook redirige aquí con ?code&state (el
 *     `service` viaja dentro de `state`, firmado — una única URL de
 *     redirección registrada sirve para los tres servicios). Canjea el code
 *     por un token de usuario de corta duración y luego por uno de larga
 *     duración (~60 días), guardado en una cookie firmada httpOnly de corta
 *     vida (distinta por servicio) mientras el usuario elige la cuenta.
 *   - action=accounts   (GET)  Lista las cuentas/páginas/cuentas de
 *     Instagram de ESE servicio a las que la persona tiene acceso.
 *   - action=finalize   (POST) Guarda en data_sources la cuenta elegida.
 *     Para 'page'/'instagram', las llamadas a la API se autentican con el
 *     token de la PÁGINA (no el del usuario) — se obtiene aquí mismo, en el
 *     momento de finalizar, para que nunca llegue al navegador.
 *
 * Importante: la URL de redirección registrada en la app de Meta y en la
 * variable de entorno META_OAUTH_REDIRECT_URI debe ser
 * ".../api/oauth-facebook?action=callback" (sin &service=, se recupera del
 * `state`).
 */
import { timingSafeEqual, createHmac } from 'crypto'

type FacebookService = 'ads' | 'page' | 'instagram'

const SERVICE_CONFIG: Record<FacebookService, { scope: string; platform: string; pendingCookie: string }> = {
  ads: { scope: 'ads_read', platform: 'meta-ads', pendingCookie: 'mp_facebook_oauth_pending_ads' },
  page: { scope: 'pages_show_list,pages_read_engagement', platform: 'facebook', pendingCookie: 'mp_facebook_oauth_pending_page' },
  instagram: {
    scope: 'pages_show_list,instagram_basic,instagram_manage_insights',
    platform: 'instagram',
    pendingCookie: 'mp_facebook_oauth_pending_instagram',
  },
}

const STATE_TTL_MS = 10 * 60 * 1000
const PENDING_TTL_S = 10 * 60
const LONG_LIVED_TOKEN_TTL_S = 60 * 24 * 60 * 60 // Meta emite el token de larga duración con ~60 días de vida.

function isFacebookService(value: unknown): value is FacebookService {
  return value === 'ads' || value === 'page' || value === 'instagram'
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

function signState(slug: string, service: FacebookService, secret: string): string {
  const expiry = Date.now() + STATE_TTL_MS
  const sig = createHmac('sha256', secret).update(`oauth-state:${slug}:${service}:${expiry}`).digest('hex')
  return Buffer.from(`${slug}.${service}.${expiry}.${sig}`).toString('base64url')
}

function verifyState(state: string, secret: string): { slug: string; service: FacebookService } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [slug, service, expiryStr, sig] = decoded.split('.')
    const expiry = Number(expiryStr)
    if (!slug || !isFacebookService(service) || !expiry || !sig || Date.now() > expiry) return null
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

function signPendingCookie(payload: { slug: string; token: string; exp: number }, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  return `${json}.${sig}`
}

function readPendingToken(cookieValue: string, slug: string, secret: string): string | null {
  const [json, sig] = cookieValue.split('.')
  if (!json || !sig) return null
  const expected = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as {
      slug: string
      token: string
      exp: number
    }
    if (payload.slug !== slug || Date.now() > payload.exp) return null
    return payload.token
  } catch {
    return null
  }
}

function reportOrigin(): string {
  return process.env.PUBLIC_APP_URL || 'https://client-reporting-dashboard-orpin.vercel.app'
}

function htmlError(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;color:#e5e5e5;background:#0b0b0c">
    <h3>No se pudo completar la conexión con Facebook</h3>
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
    res.status(500).json({ error: `Error inesperado en /api/oauth-facebook: ${(e as Error).message}` })
  }
}

/** action=start — GET ?service=ads|page|instagram&client=<slug>&token=<sesión opcional> */
async function handleStart(req: any, res: any) {
  const service = req.query?.service
  if (!isFacebookService(service)) {
    res.status(400).send('Falta o es inválido el parámetro service (ads | page | instagram).')
    return
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET, META_APP_ID, META_OAUTH_REDIRECT_URI } = process.env
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

  const state = signState(slug, service, AUTH_TOKEN_SECRET)
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: META_OAUTH_REDIRECT_URI,
    state,
    scope: SERVICE_CONFIG[service].scope,
    response_type: 'code',
  })
  res.writeHead(302, { Location: `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}` })
  res.end()
}

/** action=callback — GET, redirigido por Facebook con ?code&state */
async function handleCallback(req: any, res: any) {
  const { AUTH_TOKEN_SECRET, META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI } = process.env
  if (!AUTH_TOKEN_SECRET || !META_APP_ID || !META_APP_SECRET || !META_OAUTH_REDIRECT_URI) {
    res.status(500).send(htmlError('Faltan variables de entorno en el servidor (META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI, AUTH_TOKEN_SECRET).'))
    return
  }

  const errorParam = typeof req.query?.error_description === 'string' ? req.query.error_description : ''
  if (errorParam) {
    res.status(400).send(htmlError(`Facebook denegó la solicitud: ${errorParam}`))
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
    const shortResp = await fetch(
      `https://graph.facebook.com/v25.0/oauth/access_token?${new URLSearchParams({
        client_id: META_APP_ID,
        redirect_uri: META_OAUTH_REDIRECT_URI,
        client_secret: META_APP_SECRET,
        code,
      }).toString()}`,
    )
    const shortBody = (await shortResp.json()) as { access_token?: string; error?: { message: string } }
    if (!shortResp.ok || !shortBody.access_token) {
      throw new Error(shortBody.error?.message || `Facebook respondió ${shortResp.status} al canjear el código.`)
    }

    const longResp = await fetch(
      `https://graph.facebook.com/v25.0/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortBody.access_token,
      }).toString()}`,
    )
    const longBody = (await longResp.json()) as { access_token?: string; expires_in?: number; error?: { message: string } }
    if (!longResp.ok || !longBody.access_token) {
      throw new Error(longBody.error?.message || `Facebook respondió ${longResp.status} al obtener el token de larga duración.`)
    }

    const exp = Date.now() + PENDING_TTL_S * 1000
    const cookieValue = signPendingCookie({ slug: state.slug, token: longBody.access_token, exp }, AUTH_TOKEN_SECRET)
    res.setHeader(
      'Set-Cookie',
      `${SERVICE_CONFIG[state.service].pendingCookie}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-facebook; HttpOnly; Secure; SameSite=Lax`,
    )
    res.writeHead(302, { Location: `${reportOrigin()}/c/${state.slug}/settings?facebook_oauth=${state.service}` })
    res.end()
  } catch (e) {
    res.status(502).send(htmlError((e as Error).message))
  }
}

/** action=accounts — GET ?service=ads|page|instagram&client=<slug> */
async function handleAccounts(req: any, res: any) {
  const service = req.query?.service
  if (!isFacebookService(service)) {
    res.status(400).json({ error: 'Falta o es inválido el parámetro service (ads | page | instagram).' })
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
  const token = cookies[cookieName] ? readPendingToken(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
  if (!token) {
    res.status(401).json({ error: 'La sesión de conexión con Facebook ha caducado. Vuelve a pulsar "Conectar con Facebook".' })
    return
  }

  try {
    if (service === 'ads') {
      const resp = await fetch(
        `https://graph.facebook.com/v25.0/me/adaccounts?${new URLSearchParams({
          fields: 'account_id,name,account_status',
          limit: '200',
          access_token: token,
        }).toString()}`,
      )
      const body = (await resp.json()) as { data?: Array<{ account_id: string; name: string; account_status: number }>; error?: { message: string } }
      if (!resp.ok) throw new Error(body.error?.message || `Facebook respondió ${resp.status}.`)
      const accounts = (body.data ?? []).map((a) => ({
        id: `act_${a.account_id}`,
        name: a.name,
        active: a.account_status === 1,
      }))
      res.status(200).json({ accounts })
      return
    }

    // service === 'page' | 'instagram' — ambas parten de la lista de páginas.
    const resp = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?${new URLSearchParams({
        fields: 'id,name,instagram_business_account{id,username}',
        limit: '200',
        access_token: token,
      }).toString()}`,
    )
    const body = (await resp.json()) as {
      data?: Array<{ id: string; name: string; instagram_business_account?: { id: string; username: string } }>
      error?: { message: string }
    }
    if (!resp.ok) throw new Error(body.error?.message || `Facebook respondió ${resp.status}.`)

    if (service === 'page') {
      const accounts = (body.data ?? []).map((p) => ({ id: p.id, name: p.name }))
      res.status(200).json({ accounts })
      return
    }

    // service === 'instagram': solo páginas con una cuenta de Instagram Business/Creator vinculada.
    const accounts = (body.data ?? [])
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        id: p.instagram_business_account!.id,
        name: `@${p.instagram_business_account!.username} (${p.name})`,
        pageId: p.id,
      }))
    res.status(200).json({ accounts })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudieron listar las cuentas de Facebook.' })
  }
}

/** action=finalize — POST { client, service, accountId, pageId? } */
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

  const { client: slug, service, accountId, pageId } = req.body ?? {}
  if (!slug || !isFacebookService(service) || !accountId) {
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
  const userToken = cookies[cookieName] ? readPendingToken(cookies[cookieName], slug, AUTH_TOKEN_SECRET) : null
  if (!userToken) {
    res.status(401).json({ error: 'La sesión de conexión con Facebook ha caducado. Vuelve a pulsar "Conectar con Facebook".' })
    return
  }

  try {
    // 'ads' se autentica con el token del usuario directamente; 'page' e
    // 'instagram' se autentican con el token de LA PÁGINA (Meta lo exige
    // para leer insights) — se pide aquí, en el servidor, para que nunca
    // llegue al navegador.
    let storedToken = userToken
    if (service === 'page' || service === 'instagram') {
      const targetPageId = service === 'page' ? accountId : pageId
      if (!targetPageId) {
        res.status(400).json({ error: 'Falta el campo pageId (necesario para Instagram).' })
        return
      }
      const pageResp = await fetch(
        `https://graph.facebook.com/v25.0/${targetPageId}?${new URLSearchParams({
          fields: 'access_token',
          access_token: userToken,
        }).toString()}`,
      )
      const pageBody = (await pageResp.json()) as { access_token?: string; error?: { message: string } }
      if (!pageResp.ok || !pageBody.access_token) {
        throw new Error(pageBody.error?.message || `Facebook respondió ${pageResp.status} al obtener el token de la página.`)
      }
      storedToken = pageBody.access_token
    }

    const expiresAt = new Date(Date.now() + LONG_LIVED_TOKEN_TTL_S * 1000).toISOString()
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
          oauth_access_token: storedToken,
          oauth_token_expires_at: expiresAt,
        },
      ]),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al guardar data_sources.` })
      return
    }
    res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; Path=/api/oauth-facebook; HttpOnly; Secure; SameSite=Lax`)
    const [row] = await resp.json()
    res.status(200).json({ source: row })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudo guardar en Supabase.' })
  }
}
