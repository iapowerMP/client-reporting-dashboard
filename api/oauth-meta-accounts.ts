/**
 * Vercel Function: GET /api/oauth-meta-accounts?client=<slug>
 * Tercer paso del "Conectar con Facebook": lee el token pendiente (cookie
 * httpOnly puesta por /api/oauth-meta-callback) y devuelve la lista de
 * cuentas publicitarias de Meta a las que esa persona tiene acceso, para que
 * elija cuál conectar a este cliente. No requiere estar en nuestro Business
 * Manager: son las cuentas del propio usuario que inició sesión.
 */
import { timingSafeEqual, createHmac } from 'crypto'

const PENDING_COOKIE = 'mp_meta_oauth_pending'

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

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/oauth-meta-accounts: ${(e as Error).message}` })
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
  const token = cookies[PENDING_COOKIE] ? readPendingToken(cookies[PENDING_COOKIE], slug, AUTH_TOKEN_SECRET) : null
  if (!token) {
    res.status(401).json({ error: 'La sesión de conexión con Facebook ha caducado. Vuelve a pulsar "Conectar con Facebook".' })
    return
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/v25.0/me/adaccounts?${new URLSearchParams({
        fields: 'account_id,name,account_status',
        limit: '200',
        access_token: token,
      }).toString()}`,
    )
    const body = (await resp.json()) as { data?: Array<{ account_id: string; name: string; account_status: number }>; error?: { message: string } }
    if (!resp.ok) {
      throw new Error(body.error?.message || `Facebook respondió ${resp.status}.`)
    }
    const accounts = (body.data ?? []).map((a) => ({
      id: `act_${a.account_id}`,
      name: a.name,
      active: a.account_status === 1,
    }))
    res.status(200).json({ accounts })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message || 'No se pudieron listar las cuentas de Meta Ads.' })
  }
}
