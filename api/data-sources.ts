/**
 * Vercel Function: /api/data-sources
 * GET  ?client=<slug>            -> fuentes de datos (plataforma + external_id)
 *                                    de ese cliente, para precargar Configuración.
 * POST { client, platform, externalId } -> guarda/actualiza el identificador de
 *         cuenta de una plataforma (p. ej. el Customer ID de Google Ads) para
 *         ese cliente.
 *
 * El deployment es compartido por todos los clientes: el cliente se resuelve
 * en cada petición a partir del slug (columna `clients.slug`), no de una
 * variable de entorno fija.
 *
 * Exige un usuario con acceso a ese cliente (Authorization: Bearer <token>,
 * emitido por /api/auth?action=login) tanto para leer como para guardar.
 */
import { timingSafeEqual, createHmac } from 'crypto'

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

/** Comprueba que quien hace la petición es un usuario con acceso a este
 * cliente (admin: acceso implícito a todos; el resto: fila en
 * user_client_access). */
async function checkAccess(req: any, clientId: string, supabaseUrl: string, serviceRoleKey: string): Promise<boolean> {
  const secret = process.env.AUTH_TOKEN_SECRET
  if (!secret) return false
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
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

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/data-sources: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
    })
    return
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  if (req.method === 'GET') {
    const slug = typeof req.query?.client === 'string' ? req.query.client : ''
    if (!slug) {
      res.status(400).json({ error: 'Falta el parámetro client en la petición.' })
      return
    }
    let client: { id: string } | null
    try {
      client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
    } catch (e) {
      res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
      return
    }
    if (!client) {
      res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
      return
    }
    if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
      res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
      return
    }
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${client.id}&select=platform,external_id,status,last_sync,auth_method`
      const resp = await fetch(url, { headers })
      if (!resp.ok) {
        res.status(502).json({ error: `Supabase respondió ${resp.status} al leer data_sources.` })
        return
      }
      res.status(200).json({ sources: await resp.json() })
    } catch {
      res.status(502).json({ error: 'No se pudo leer data_sources desde Supabase.' })
    }
    return
  }

  if (req.method === 'POST') {
    const { client: slug, platform, externalId: rawExternalId } = req.body ?? {}
    if (!slug || !platform || typeof rawExternalId !== 'string') {
      res.status(400).json({ error: 'Faltan campos: client, platform y externalId son obligatorios.' })
      return
    }
    // El Customer ID de Google Ads se muestra con guiones (XXX-XXX-XXXX) pero
    // la API solo acepta dígitos; el Ad Account ID de Meta siempre lleva el
    // prefijo "act_". Se normaliza aquí para que el guardado sea siempre
    // válido independientemente de cómo lo escriba el usuario.
    let externalId = rawExternalId.trim()
    if (platform === 'google-ads') {
      externalId = externalId.replace(/\D/g, '')
    } else if (platform === 'meta-ads') {
      const digits = externalId.replace(/^act_/i, '').trim()
      externalId = digits ? `act_${digits}` : ''
    }
    let client: { id: string } | null
    try {
      client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
    } catch (e) {
      res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
      return
    }
    if (!client) {
      res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
      return
    }
    if (!(await checkAccess(req, client.id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
      res.status(401).json({ error: 'No tienes acceso a este informe. Inicia sesión de nuevo.' })
      return
    }
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?on_conflict=client_id,platform`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([
          {
            client_id: client.id,
            platform,
            external_id: externalId,
            status: 'conectado',
            // Guardar el ID a mano siempre vuelve al modo de conexión por API,
            // aunque antes estuviera conectado por inicio de sesión (su token
            // deja de usarse).
            auth_method: 'api',
            oauth_access_token: null,
            oauth_token_expires_at: null,
          },
        ]),
      })
      if (!resp.ok) {
        res.status(502).json({ error: `Supabase respondió ${resp.status} al guardar data_sources.` })
        return
      }
      const [row] = await resp.json()
      res.status(200).json({ source: row })
    } catch {
      res.status(502).json({ error: 'No se pudo guardar en Supabase.' })
    }
    return
  }

  res.status(405).json({ error: 'Método no permitido.' })
}
