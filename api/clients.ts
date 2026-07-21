/**
 * Vercel Function: /api/clients
 * GET               -> lista los clientes (id, name, slug, sector) para la
 *                       pantalla de selección inicial.
 * GET ?slug=<slug>  -> un único cliente con todos sus campos (incluye
 *                       website y logo_url), para precargar Configuración.
 * POST { name, sector?, website? } -> crea un cliente nuevo, generando un
 *         slug único a partir del nombre, y lo devuelve. Ese slug es el que
 *         identifica al cliente en la URL (/c/<slug>/...).
 * PATCH { client, name?, sector?, website?, logoUrl?, businessType?,
 *          cplTarget?, leadsTargetMonthly?, roasTarget?, revenueTargetMonthly?,
 *          password?, removePassword? }
 *         -> actualiza los datos del cliente (identificado por su slug actual).
 *         Si cambia el nombre, el slug (y por tanto la URL /c/<slug>/...) se
 *         regenera a partir del nuevo nombre. Si el cliente ya tiene
 *         contraseña activada, el PATCH exige el token de sesión (Authorization:
 *         Bearer <token>, emitido por /api/verify-access) para poder aplicar
 *         cualquier cambio, incluida la propia contraseña.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
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
        const url = `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id,name,slug,sector,website,logo_url,access_password_hash,business_type,cpl_target,leads_target_monthly,roas_target,revenue_target_monthly`
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
        const { access_password_hash, ...publicRow } = row
        res.status(200).json({ client: { ...publicRow, hasPassword: !!access_password_hash } })
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
    const {
      client: slug,
      name,
      sector,
      website,
      logoUrl,
      businessType,
      cplTarget,
      leadsTargetMonthly,
      roasTarget,
      revenueTargetMonthly,
      password,
      removePassword,
    } = req.body ?? {}
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'Falta el campo client (slug del cliente).' })
      return
    }

    const updates: Record<string, string | number | null> = {}
    if (typeof name === 'string' && name.trim()) updates.name = name.trim()
    if (typeof sector === 'string') updates.sector = sector.trim() || null
    if (typeof website === 'string') updates.website = website.trim() || null
    if (typeof logoUrl === 'string') updates.logo_url = logoUrl.trim() || null
    if (businessType === 'leadgen' || businessType === 'ecommerce') {
      updates.business_type = businessType
    } else if (businessType === '' || businessType === null) {
      updates.business_type = null
    }
    // Targets de Paid Media: '' o null limpia el valor; un campo ausente
    // (undefined) no se toca.
    const parseTarget = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    const targetFields: Array<[unknown, string]> = [
      [cplTarget, 'cpl_target'],
      [leadsTargetMonthly, 'leads_target_monthly'],
      [roasTarget, 'roas_target'],
      [revenueTargetMonthly, 'revenue_target_monthly'],
    ]
    for (const [value, column] of targetFields) {
      const parsed = parseTarget(value)
      if (parsed !== undefined) updates[column] = parsed
    }
    if (typeof password === 'string' && password.trim()) {
      updates.access_password_hash = hashPassword(password.trim())
    } else if (removePassword === true) {
      updates.access_password_hash = null
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No hay ningún campo que actualizar.' })
      return
    }

    try {
      // Si el cliente ya tiene contraseña activada, cualquier cambio (incluida
      // la propia contraseña) exige un token de sesión válido para ese slug.
      const currentResp = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=access_password_hash`,
        { headers },
      )
      if (!currentResp.ok) {
        res.status(502).json({ error: `Supabase respondió ${currentResp.status} al leer el cliente.` })
        return
      }
      const [currentRow] = await currentResp.json()
      if (!currentRow) {
        res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
        return
      }
      if (currentRow.access_password_hash) {
        const authHeader = req.headers?.authorization ?? ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        const secret = process.env.AUTH_TOKEN_SECRET
        if (!secret || !token || !verifyToken(token, slug, secret)) {
          res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
          return
        }
      }

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
      const { access_password_hash, ...publicRow } = row
      res.status(200).json({ client: { ...publicRow, hasPassword: !!access_password_hash } })
    } catch {
      res.status(502).json({ error: 'No se pudo actualizar el cliente en Supabase.' })
    }
    return
  }

  res.status(405).json({ error: 'Método no permitido.' })
}
