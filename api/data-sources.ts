/**
 * Vercel Function: /api/data-sources
 * GET  -> devuelve las fuentes de datos (plataforma + external_id) del cliente
 *         de este deployment, para precargar los campos en Configuración.
 * POST -> guarda/actualiza el identificador de cuenta de una plataforma
 *         (p. ej. el Customer ID de Google Ads) para ese mismo cliente.
 *         Body: { platform: string, externalId: string }
 *
 * El client_id de este dashboard vive en el servidor (DASHBOARD_CLIENT_ID) y
 * nunca lo envía el navegador: cada copia del proyecto solo puede leer/editar
 * los datos de su propio cliente.
 */

export default async function handler(req: any, res: any) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_CLIENT_ID } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DASHBOARD_CLIENT_ID) {
    res.status(500).json({
      error:
        'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_CLIENT_ID).',
    })
    return
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  if (req.method === 'GET') {
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?client_id=eq.${DASHBOARD_CLIENT_ID}&select=platform,external_id,status,last_sync`
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
    const { platform, externalId } = req.body ?? {}
    if (!platform || typeof externalId !== 'string') {
      res.status(400).json({ error: 'Faltan campos: platform y externalId son obligatorios.' })
      return
    }
    try {
      const url = `${SUPABASE_URL}/rest/v1/data_sources?on_conflict=client_id,platform`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([
          { client_id: DASHBOARD_CLIENT_ID, platform, external_id: externalId, status: 'conectado' },
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
