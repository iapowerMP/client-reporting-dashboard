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
 */

async function resolveClientId(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
): Promise<string | null> {
  const url = `${supabaseUrl}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id`
  const resp = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!resp.ok) return null
  const rows = (await resp.json()) as Array<{ id: string }>
  return rows[0]?.id ?? null
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
    let clientId: string | null
    try {
      clientId = await resolveClientId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
    } catch (e) {
      res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
      return
    }
    if (!clientId) {
      res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
      return
    }
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${clientId}&select=platform,external_id,status,last_sync`
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
    const { client: slug, platform, externalId } = req.body ?? {}
    if (!slug || !platform || typeof externalId !== 'string') {
      res.status(400).json({ error: 'Faltan campos: client, platform y externalId son obligatorios.' })
      return
    }
    let clientId: string | null
    try {
      clientId = await resolveClientId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
    } catch (e) {
      res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
      return
    }
    if (!clientId) {
      res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
      return
    }
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?on_conflict=client_id,platform`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([
          { client_id: clientId, platform, external_id: externalId, status: 'conectado' },
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
