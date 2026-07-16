/**
 * Vercel Function: GET /api/oauth-meta-callback
 * Segundo paso del "Conectar con Facebook": Facebook redirige aquí con un
 * `code` tras el consentimiento del usuario. Lo intercambiamos por un token
 * de usuario de corta duración y luego por uno de larga duración (~60 días),
 * y lo guardamos en una cookie firmada y de corta vida (10 min, httpOnly)
 * mientras el usuario elige qué cuenta publicitaria conectar en el paso
 * siguiente (/api/oauth-meta-accounts → /api/oauth-meta-finalize). El token
 * NUNCA llega al navegador como JS-accesible ni se guarda en la URL.
 */
import { timingSafeEqual, createHmac } from 'crypto'

const PENDING_COOKIE = 'mp_meta_oauth_pending'
const PENDING_TTL_S = 10 * 60

function verifyState(state: string, secret: string): { slug: string } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const [slug, expiryStr, sig] = decoded.split('.')
    const expiry = Number(expiryStr)
    if (!slug || !expiry || !sig || Date.now() > expiry) return null
    const expected = createHmac('sha256', secret).update(`oauth-state:${slug}:${expiry}`).digest('hex')
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    return { slug }
  } catch {
    return null
  }
}

function signPendingCookie(payload: { slug: string; token: string; exp: number }, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  return `${json}.${sig}`
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
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).send(htmlError(`Error inesperado: ${(e as Error).message}`))
  }
}

async function handleRequest(req: any, res: any) {
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
      `${PENDING_COOKIE}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-meta; HttpOnly; Secure; SameSite=Lax`,
    )
    res.writeHead(302, { Location: `${reportOrigin()}/c/${state.slug}/settings?meta_oauth=picking` })
    res.end()
  } catch (e) {
    res.status(502).send(htmlError((e as Error).message))
  }
}
