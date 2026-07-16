/**
 * Vercel Function: /api/admin?action=login|clients
 * Panel de administración general (/admin), unificado en un solo archivo
 * (en vez de 2 funciones separadas) para no superar el límite de
 * Serverless Functions del plan de Vercel.
 *
 *   - action=login    (POST) Body: { password }. Compara con la variable de
 *     entorno ADMIN_PASSWORD y devuelve un token firmado (válido 12h).
 *   - action=clients  (GET)  Header: Authorization: Bearer <token>. Devuelve
 *     todos los clientes con sus integraciones y si tienen contraseña.
 */
import { timingSafeEqual, createHmac } from 'crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function signToken(subject: string, secret: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS
  const sig = createHmac('sha256', secret).update(`${subject}:${expiry}`).digest('hex')
  return `${expiry}.${sig}`
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

export default async function handler(req: any, res: any) {
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  try {
    switch (action) {
      case 'login':
        return await handleLogin(req, res)
      case 'clients':
        return await handleClients(req, res)
      default:
        res.status(400).json({ error: 'Falta o es inválido el parámetro action.' })
    }
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/admin: ${(e as Error).message}` })
  }
}

/** action=login — POST { password } */
async function handleLogin(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }

  const { ADMIN_PASSWORD, AUTH_TOKEN_SECRET } = process.env
  if (!ADMIN_PASSWORD || !AUTH_TOKEN_SECRET) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (ADMIN_PASSWORD, AUTH_TOKEN_SECRET).',
    })
    return
  }

  const { password } = req.body ?? {}
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Falta el campo password.' })
    return
  }

  if (!safeEqual(password, ADMIN_PASSWORD)) {
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' })
    return
  }

  res.status(200).json({ ok: true, token: signToken('admin', AUTH_TOKEN_SECRET) })
}

/** action=clients — GET, Header: Authorization: Bearer <token> */
async function handleClients(req: any, res: any) {
  if (req.method !== 'GET') {
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

  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token || !verifyToken(token, 'admin', AUTH_TOKEN_SECRET)) {
    res.status(401).json({ error: 'No autorizado.' })
    return
  }

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  try {
    const [clientsResp, sourcesResp] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/clients?select=id,name,slug,sector,website,access_password_hash,created_at&order=created_at.desc`,
        { headers },
      ),
      fetch(`${SUPABASE_URL}/rest/v1/data_sources?select=client_id,platform`, { headers }),
    ])
    if (!clientsResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${clientsResp.status} al leer clients.` })
      return
    }
    if (!sourcesResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${sourcesResp.status} al leer data_sources.` })
      return
    }

    const clientRows = (await clientsResp.json()) as Array<{
      id: string
      name: string
      slug: string
      sector: string | null
      website: string | null
      access_password_hash: string | null
      created_at: string
    }>
    const sourceRows = (await sourcesResp.json()) as Array<{ client_id: string; platform: string }>

    const platformsByClient = new Map<string, string[]>()
    for (const s of sourceRows) {
      const list = platformsByClient.get(s.client_id) ?? []
      list.push(s.platform)
      platformsByClient.set(s.client_id, list)
    }

    const clients = clientRows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sector: c.sector,
      website: c.website,
      createdAt: c.created_at,
      hasPassword: !!c.access_password_hash,
      platforms: platformsByClient.get(c.id) ?? [],
    }))

    res.status(200).json({ clients })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Supabase.' })
  }
}
