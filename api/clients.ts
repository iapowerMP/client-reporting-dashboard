/**
 * Vercel Function: /api/clients
 * GET               -> lista los clientes (id, name, slug, sector) para la
 *                       pantalla de selección inicial.
 * GET ?slug=<slug>  -> un único cliente con todos sus campos (incluye
 *                       website y logo_url), para precargar Configuración.
 * POST { name, sector?, website? } -> crea un cliente nuevo, generando un
 *         slug único a partir del nombre, y lo devuelve. Ese slug es el que
 *         identifica al cliente en la URL (/c/<slug>/...).
 * PATCH { client, name?, sector?, website?, logoUrl? } -> actualiza los datos
 *         del cliente (identificado por su slug actual). Si cambia el nombre,
 *         el slug (y por tanto la URL /c/<slug>/...) se regenera a partir del
 *         nuevo nombre — un enlace guardado con el nombre anterior deja de
 *         funcionar. El PATCH devuelve el cliente con su slug final.
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
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/clients: ${(e as Error).message}` })
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
    const slug = typeof req.query?.slug === 'string' ? req.query.slug : ''

    if (slug) {
      try {
        const url = `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id,name,slug,sector,website,logo_url`
        const resp = await fetch(url, { headers })
        if (!resp.ok) {
          res.status(502).json({ error: `Supabase respondió ${resp.status} al leer clients.` })
          return
        }
        const [row] = await resp.json()
        if (!row) {
          res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
          return
        }
        res.status(200).json({ client: row })
      } catch {
        res.status(502).json({ error: 'No se pudo leer clients desde Supabase.' })
      }
      return
    }

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

  if (req.method === 'PATCH') {
    const { client: slug, name, sector, website, logoUrl } = req.body ?? {}
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'Falta el campo client (slug del cliente).' })
      return
    }

    const updates: Record<string, string | null> = {}
    if (typeof name === 'string' && name.trim()) updates.name = name.trim()
    if (typeof sector === 'string') updates.sector = sector.trim() || null
    if (typeof website === 'string') updates.website = website.trim() || null
    if (typeof logoUrl === 'string') updates.logo_url = logoUrl.trim() || null

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No hay ningún campo que actualizar.' })
      return
    }

    try {
      // Si cambia el nombre, la URL (slug) le sigue, para que el enlace del
      // informe siempre refleje el nombre actual del cliente.
      if (typeof updates.name === 'string') {
        const newBase = slugify(updates.name) || 'cliente'
        if (newBase !== slug) {
          let candidate = newBase
          for (let attempt = 0; attempt < 20; attempt++) {
            const checkResp = await fetch(
              `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(candidate)}&select=id`,
              { headers },
            )
            if (!checkResp.ok) {
              res.status(502).json({ error: `Supabase respondió ${checkResp.status} al comprobar el slug.` })
              return
            }
            const existing = await checkResp.json()
            if (existing.length === 0) break
            candidate = `${newBase}-${attempt + 2}`
          }
          updates.slug = candidate
        }
      }

      const url = `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}`
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(updates),
      })
      if (!resp.ok) {
        res.status(502).json({ error: `Supabase respondió ${resp.status} al actualizar el cliente.` })
        return
      }
      const [row] = await resp.json()
      if (!row) {
        res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
        return
      }
      res.status(200).json({ client: row })
    } catch {
      res.status(502).json({ error: 'No se pudo actualizar el cliente en Supabase.' })
    }
    return
  }

  res.status(405).json({ error: 'Método no permitido.' })
}
