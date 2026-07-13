/**
 * Vercel Function: /api/clients
 * GET  -> lista los clientes (id, name, slug, sector) para la pantalla de
 *         selección inicial.
 * POST { name, sector?, website? } -> crea un cliente nuevo, generando un
 *         slug único a partir del nombre, y lo devuelve. Ese slug es el que
 *         identifica al cliente en la URL (/c/<slug>/...).
 */

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default async function handler(req: any, res: any) {
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
    try {
      const url = `${SUPABASE_URL}/rest/v1/clients?select=id,name,slug,sector&order=created_at.desc`
      const resp = await fetch(url, { headers })
      if (!resp.ok) {
        res.status(502).json({ error: `Supabase respondió ${resp.status} al leer clients.` })
        return
      }
      res.status(200).json({ clients: await resp.json() })
    } catch {
      res.status(502).json({ error: 'No se pudo leer clients desde Supabase.' })
    }
    return
  }

  if (req.method === 'POST') {
    const { name, sector, website } = req.body ?? {}
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Falta el campo name.' })
      return
    }

    const base = slugify(name) || 'cliente'
    let slug = base
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const checkUrl = `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id`
        const checkResp = await fetch(checkUrl, { headers })
        if (!checkResp.ok) {
          res.status(502).json({ error: `Supabase respondió ${checkResp.status} al comprobar el slug.` })
          return
        }
        const existing = await checkResp.json()
        if (existing.length === 0) break
        slug = `${base}-${attempt + 2}`
      }

      const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify([{ name, sector: sector || null, website: website || null, slug }]),
      })
      if (!insertResp.ok) {
        res.status(502).json({ error: `Supabase respondió ${insertResp.status} al crear el cliente.` })
        return
      }
      const [row] = await insertResp.json()
      res.status(200).json({ client: row })
    } catch {
      res.status(502).json({ error: 'No se pudo crear el cliente en Supabase.' })
    }
    return
  }

  res.status(405).json({ error: 'Método no permitido.' })
}
