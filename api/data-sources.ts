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
 * Si el cliente tiene contraseña activada (clients.access_password_hash), se
 * exige el token de sesión (Authorization: Bearer <token>, emitido por
 * /api/verify-access) tanto para leer como para guardar.
 */
import { timingSafeEqual, createHmac } from 'crypto'

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

function checkAccess(req: any, client: { access_password_hash: string | null }, slug: string): boolean {
  if (!client.access_password_hash) return true
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secret = process.env.AUTH_TOKEN_SECRET
  return !!secret && !!token && verifyToken(token, slug, secret)
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
    let client: { id: string; access_password_hash: string | null } | null
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
    if (!checkAccess(req, client, slug)) {
      res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
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
    let client: { id: string; access_password_hash: string | null } | null
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
    if (!checkAccess(req, client, slug)) {
      res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
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
