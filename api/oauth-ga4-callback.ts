/**
 * Vercel Function: GET /api/oauth-ga4-callback
 * Segundo paso del "Conectar con Google" de GA4: Google redirige aquí con un
 * `code` tras el consentimiento. Lo canjeamos por un access_token (1h) y un
 * refresh_token (no caduca hasta que se revoque), y guardamos el refresh
 * token en una cookie firmada y de corta vida (10 min, httpOnly) mientras el
 * usuario elige qué propiedad GA4 conectar en el paso siguiente
 * (/api/oauth-ga4-accounts → /api/oauth-ga4-finalize).
 */
import { timingSafeEqual, createHmac } from 'crypto'

const PENDING_COOKIE = 'mp_ga4_oauth_pending'
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

function signPendingCookie(payload: { slug: string; accessToken: string; refreshToken: string; exp: number }, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`oauth-pending:${json}`).digest('hex')
  return `${json}.${sig}`
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
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).send(htmlError(`Error inesperado: ${(e as Error).message}`))
  }
}

async function handleRequest(req: any, res: any) {
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
      `${PENDING_COOKIE}=${cookieValue}; Max-Age=${PENDING_TTL_S}; Path=/api/oauth-ga4; HttpOnly; Secure; SameSite=Lax`,
    )
    res.writeHead(302, { Location: `${reportOrigin()}/c/${state.slug}/settings?ga4_oauth=picking` })
    res.end()
  } catch (e) {
    res.status(502).send(htmlError((e as Error).message))
  }
}
