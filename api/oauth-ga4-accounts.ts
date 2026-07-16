/**
 * Vercel Function: GET /api/oauth-ga4-accounts?client=<slug>
 * Tercer paso del "Conectar con Google": lee el access_token pendiente
 * (cookie httpOnly puesta por /api/oauth-ga4-callback) y devuelve las
 * propiedades GA4 a las que esa persona tiene acceso, para que elija cuál
 * conectar a este cliente.
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

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/oauth-ga4-accounts: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
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
  const session = cookies[PENDING_COOKIE] ? readPendingSession(cookies[PENDING_COOKIE], slug, AUTH_TOKEN_SECRET) : null
  if (!session) {
    res.status(401).json({ error: 'La sesión de conexión con Google ha caducado. Vuelve a pulsar "Conectar con Google".' })
    return
  }

  try {
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
    if (!resp.ok) {
      throw new Error(body.error?.message || `Google respondió ${resp.status}.`)
    }
    const accounts = (body.accountSummaries ?? []).flatMap((acc) =>
      (acc.propertySummaries ?? []).map((p) => ({
        id: p.property, // "properties/XXXXXXXXX"
        name: `${p.displayName} (${acc.displayName})`,
      })),
    )
    res.status(200).json({ accounts })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudieron listar las propiedades de GA4.' })
  }
}
