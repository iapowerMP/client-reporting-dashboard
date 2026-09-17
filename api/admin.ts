/**
 * Vercel Function: /api/admin?action=clients|users|create-user|update-user|
 *   reset-password|sync-status|support-create|support-list|support-resolve
 * Panel de administración general (/admin) y bandeja de incidencias,
 * unificados en un solo archivo (en vez de varias funciones separadas) para
 * no superar el límite de Serverless Functions del plan de Vercel. El login
 * vive en /api/auth?action=login. Salvo `support-create` (cualquier usuario
 * autenticado con acceso a ese cliente, para poder enviar una incidencia
 * desde su propio informe), todas las demás acciones exigen que el token
 * recibido (Authorization: Bearer <token>) pertenezca a un usuario con
 * role='admin'.
 *
 *   - action=clients        (GET)  Todos los clientes con sus integraciones.
 *   - action=users          (GET)  Todos los usuarios (para Admin → Usuarios),
 *     con su último login y, por cliente asignado, su última visita.
 *   - action=create-user     (POST) Body: { email, name, role, clientIds[] }.
 *     Genera una contraseña temporal, la devuelve UNA VEZ en la respuesta
 *     (no se puede volver a consultar) para que el admin la comparta a mano.
 *   - action=update-user     (POST) Body: { id, role?, name?, clientIds? }.
 *     Cambia el rol, el nombre y/o la lista de informes asignados.
 *   - action=reset-password  (POST) Body: { id }. Genera una contraseña
 *     temporal nueva (igual que create-user) y fuerza a cambiarla en el
 *     próximo login — para cuando un usuario la ha perdido.
 *   - action=sync-status     (GET)  Últimas ejecuciones de sync_logs (todas
 *     las plataformas/clientes), para Admin → Monitorización.
 *   - action=support-create   (POST) Body: { clientId, type: 'ayuda'|'error',
 *     message, attachmentDataUrl? } — el formulario de ayuda/error de un
 *     informe. attachmentDataUrl = "data:<mime>;base64,<...>", igual que
 *     /api/upload-logo, subido al bucket 'incidencias'.
 *   - action=support-list     (GET)  Query opcional: status=abierto|resuelto.
 *   - action=support-resolve  (POST) Body: { id, status: 'abierto'|'resuelto' }.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
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

/** Genera una contraseña temporal legible (evita caracteres ambiguos). */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(10)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

function requiredEnv(res: any): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; AUTH_TOKEN_SECRET: string } | null {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_TOKEN_SECRET) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET).',
    })
    return null
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET }
}

/** Exige que quien llama sea un usuario con role='admin'; responde 401 si no. */
async function requireAdmin(
  req: any,
  res: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  secret: string,
): Promise<boolean> {
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const userId = token ? verifyUserToken(token, secret) : null
  if (!userId) {
    res.status(401).json({ error: 'No autorizado.' })
    return false
  }
  const resp = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=role`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  const [user] = resp.ok ? ((await resp.json()) as Array<{ role: string }>) : []
  if (!user || user.role !== 'admin') {
    res.status(401).json({ error: 'No autorizado.' })
    return false
  }
  return true
}

/** Usuario autenticado (cualquier rol) a partir del header Authorization, o null. */
async function getRequestUser(
  req: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  secret: string,
): Promise<{ id: string; role: string } | null> {
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const userId = token ? verifyUserToken(token, secret) : null
  if (!userId) return null
  const resp = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=id,role`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!resp.ok) return null
  const [user] = (await resp.json()) as Array<{ id: string; role: string }>
  return user ?? null
}

/** ¿Tiene este usuario acceso al cliente clientId? (admin: siempre). */
async function hasClientAccess(
  user: { id: string; role: string },
  clientId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<boolean> {
  if (user.role === 'admin') return true
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/user_client_access?user_id=eq.${user.id}&client_id=eq.${clientId}&select=id`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
  )
  if (!resp.ok) return false
  const rows = (await resp.json()) as Array<{ id: string }>
  return rows.length > 0
}

export default async function handler(req: any, res: any) {
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  try {
    switch (action) {
      case 'clients':
        return await handleClients(req, res)
      case 'users':
        return await handleUsers(req, res)
      case 'create-user':
        return await handleCreateUser(req, res)
      case 'update-user':
        return await handleUpdateUser(req, res)
      case 'reset-password':
        return await handleResetPassword(req, res)
      case 'sync-status':
        return await handleSyncStatus(req, res)
      case 'support-create':
        return await handleSupportCreate(req, res)
      case 'support-list':
        return await handleSupportList(req, res)
      case 'support-resolve':
        return await handleSupportResolve(req, res)
      default:
        res.status(400).json({ error: 'Falta o es inválido el parámetro action.' })
    }
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/admin: ${(e as Error).message}` })
  }
}

/** action=clients — GET, Header: Authorization: Bearer <token> (admin) */
async function handleClients(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  try {
    const [clientsResp, sourcesResp, usersResp] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/clients?select=id,name,slug,sector,website,created_at,created_by&order=created_at.desc`,
        { headers },
      ),
      fetch(`${SUPABASE_URL}/rest/v1/data_sources?select=client_id,platform`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/users?select=id,name,email`, { headers }),
    ])
    if (!clientsResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${clientsResp.status} al leer clients.` })
      return
    }
    if (!sourcesResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${sourcesResp.status} al leer data_sources.` })
      return
    }
    if (!usersResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${usersResp.status} al leer users.` })
      return
    }

    const clientRows = (await clientsResp.json()) as Array<{
      id: string
      name: string
      slug: string
      sector: string | null
      website: string | null
      created_at: string
      created_by: string | null
    }>
    const sourceRows = (await sourcesResp.json()) as Array<{ client_id: string; platform: string }>
    const userRows = (await usersResp.json()) as Array<{ id: string; name: string | null; email: string }>

    const platformsByClient = new Map<string, string[]>()
    for (const s of sourceRows) {
      const list = platformsByClient.get(s.client_id) ?? []
      list.push(s.platform)
      platformsByClient.set(s.client_id, list)
    }
    const userById = new Map(userRows.map((u) => [u.id, u.name || u.email]))

    // Clientes creados antes de que existieran cuentas de usuario (o cuya
    // cuenta creadora se ha borrado desde entonces) no tienen created_by:
    // se muestran como "Admin" en vez de dejarlo en blanco.
    const clients = clientRows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sector: c.sector,
      website: c.website,
      createdAt: c.created_at,
      createdBy: (c.created_by && userById.get(c.created_by)) || 'Admin',
      platforms: platformsByClient.get(c.id) ?? [],
    }))

    res.status(200).json({ clients })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Supabase.' })
  }
}

/** action=users — GET, Header: Authorization: Bearer <token> (admin) */
async function handleUsers(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  try {
    const [usersResp, accessResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/users?select=id,email,name,role,last_login_at,created_at&order=created_at.desc`, {
        headers,
      }),
      fetch(`${SUPABASE_URL}/rest/v1/user_client_access?select=user_id,last_viewed_at,client:clients(id,slug,name)`, {
        headers,
      }),
    ])
    if (!usersResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${usersResp.status} al leer users.` })
      return
    }
    if (!accessResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${accessResp.status} al leer user_client_access.` })
      return
    }

    const userRows = (await usersResp.json()) as Array<{
      id: string
      email: string
      name: string | null
      role: string
      last_login_at: string | null
      created_at: string
    }>
    const accessRows = (await accessResp.json()) as Array<{
      user_id: string
      last_viewed_at: string | null
      client: { id: string; slug: string; name: string } | null
    }>

    const clientsByUser = new Map<string, Array<{ id: string; slug: string; name: string; lastViewedAt: string | null }>>()
    for (const row of accessRows) {
      if (!row.client) continue
      const list = clientsByUser.get(row.user_id) ?? []
      list.push({ ...row.client, lastViewedAt: row.last_viewed_at })
      clientsByUser.set(row.user_id, list)
    }

    const users = userRows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      clients: clientsByUser.get(u.id) ?? [],
    }))

    res.status(200).json({ users })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Supabase.' })
  }
}

/** action=create-user — POST, Header: Authorization: Bearer <token> (admin)
 * Body: { email, name?, role, clientIds: string[] } */
async function handleCreateUser(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const { email, name, role, clientIds } = req.body ?? {}
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'Falta el campo email.' })
    return
  }
  if (role !== 'admin' && role !== 'project_manager' && role !== 'cliente') {
    res.status(400).json({ error: "El campo role debe ser 'admin', 'project_manager' o 'cliente'." })
    return
  }
  const ids = Array.isArray(clientIds) ? clientIds.filter((id): id is string => typeof id === 'string') : []

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
  const tempPassword = generateTempPassword()

  try {
    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify([
        {
          email: email.trim().toLowerCase(),
          name: typeof name === 'string' && name.trim() ? name.trim() : null,
          role,
          password_hash: hashPassword(tempPassword),
          must_change_password: true,
        },
      ]),
    })
    if (!insertResp.ok) {
      const body = await insertResp.text()
      const duplicate = insertResp.status === 409 || body.includes('duplicate')
      res.status(502).json({ error: duplicate ? 'Ya existe un usuario con ese email.' : `Supabase respondió ${insertResp.status} al crear el usuario.` })
      return
    }
    const [user] = (await insertResp.json()) as Array<{ id: string; email: string; name: string | null; role: string }>

    if (role !== 'admin' && ids.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_client_access`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(ids.map((clientId) => ({ user_id: user.id, client_id: clientId }))),
      })
    }

    res.status(200).json({ user, tempPassword })
  } catch {
    res.status(502).json({ error: 'No se pudo crear el usuario en Supabase.' })
  }
}

/** action=update-user — POST, Header: Authorization: Bearer <token> (admin)
 * Body: { id, role?, clientIds? } */
async function handleUpdateUser(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const { id, role, name, clientIds } = req.body ?? {}
  if (typeof id !== 'string' || !id) {
    res.status(400).json({ error: 'Falta el campo id.' })
    return
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  try {
    const updates: Record<string, string> = {}
    if (role === 'admin' || role === 'project_manager' || role === 'cliente') updates.role = role
    if (typeof name === 'string') updates.name = name.trim()

    if (Object.keys(updates).length > 0) {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      })
      if (!resp.ok) {
        res.status(502).json({ error: `Supabase respondió ${resp.status} al actualizar el usuario.` })
        return
      }
    }

    if (Array.isArray(clientIds)) {
      const ids = clientIds.filter((cid): cid is string => typeof cid === 'string')
      await fetch(`${SUPABASE_URL}/rest/v1/user_client_access?user_id=eq.${id}`, {
        method: 'DELETE',
        headers,
      })
      if (ids.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_client_access`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(ids.map((clientId) => ({ user_id: id, client_id: clientId }))),
        })
      }
    }

    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'No se pudo actualizar el usuario en Supabase.' })
  }
}

/** action=reset-password — POST, Header: Authorization: Bearer <token> (admin)
 * Body: { id }. Genera una contraseña temporal nueva, la devuelve en texto
 * plano una sola vez (igual que create-user) y fuerza a cambiarla en el
 * próximo login — para cuando un usuario ha perdido u olvidado la suya. */
async function handleResetPassword(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const { id } = req.body ?? {}
  if (typeof id !== 'string' || !id) {
    res.status(400).json({ error: 'Falta el campo id.' })
    return
  }

  const tempPassword = generateTempPassword()
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ password_hash: hashPassword(tempPassword), must_change_password: true }),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al restablecer la contraseña.` })
      return
    }
    res.status(200).json({ tempPassword })
  } catch {
    res.status(502).json({ error: 'No se pudo restablecer la contraseña en Supabase.' })
  }
}

/** action=sync-status — GET, Header: Authorization: Bearer <token> (admin)
 * Query opcional: status=Error */
async function handleSyncStatus(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const statusFilter = typeof req.query?.status === 'string' ? req.query.status : ''
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  try {
    const filter = statusFilter ? `&status=eq.${encodeURIComponent(statusFilter)}` : ''
    const url = `${SUPABASE_URL}/rest/v1/sync_logs?select=id,client_id,platform,status,records,duration_s,error_message,ran_at,client:clients(name,slug)&order=ran_at.desc&limit=200${filter}`
    const resp = await fetch(url, { headers })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al leer sync_logs.` })
      return
    }
    res.status(200).json({ runs: await resp.json() })
  } catch {
    res.status(502).json({ error: 'No se pudo leer sync_logs desde Supabase.' })
  }
}

/** action=support-create — POST, Header: Authorization: Bearer <token>
 * (cualquier usuario con acceso a clientId). Body: { clientId, type,
 * message, attachmentDataUrl? } */
async function handleSupportCreate(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env

  const user = await getRequestUser(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET)
  if (!user) {
    res.status(401).json({ error: 'No autorizado.' })
    return
  }

  const { clientId, type, message, attachmentDataUrl } = req.body ?? {}
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ error: 'Falta el campo clientId.' })
    return
  }
  if (type !== 'ayuda' && type !== 'error') {
    res.status(400).json({ error: "El campo type debe ser 'ayuda' o 'error'." })
    return
  }
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Falta el campo message.' })
    return
  }
  if (!(await hasClientAccess(user, clientId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))) {
    res.status(401).json({ error: 'No tienes acceso a este informe.' })
    return
  }

  let attachmentUrl: string | null = null
  if (typeof attachmentDataUrl === 'string' && attachmentDataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(attachmentDataUrl)
    if (!match) {
      res.status(400).json({ error: 'El archivo adjunto no llegó en el formato esperado.' })
      return
    }
    const [, contentType, base64] = match
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      res.status(400).json({ error: 'El archivo adjunto pesa demasiado (máximo 2 MB).' })
      return
    }
    const ext = contentType.split('/').pop() || 'png'
    const path = `${clientId}-${Date.now()}.${ext}`
    const uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/incidencias/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
      },
      body: bytes,
    })
    if (!uploadResp.ok) {
      res.status(502).json({ error: `Supabase Storage respondió ${uploadResp.status} al subir el adjunto.` })
      return
    }
    attachmentUrl = `${SUPABASE_URL}/storage/v1/object/public/incidencias/${path}`
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/support_requests`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        { client_id: clientId, user_id: user.id, type, message: message.trim(), attachment_url: attachmentUrl },
      ]),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al guardar la incidencia.` })
      return
    }
    const [row] = await resp.json()
    res.status(200).json({ request: row })
  } catch {
    res.status(502).json({ error: 'No se pudo guardar la incidencia en Supabase.' })
  }
}

/** action=support-list — GET, Header: Authorization: Bearer <token> (admin)
 * Query opcional: status=abierto|resuelto */
async function handleSupportList(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const statusFilter = typeof req.query?.status === 'string' ? req.query.status : ''
  const filter = statusFilter ? `&status=eq.${encodeURIComponent(statusFilter)}` : ''
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }

  try {
    const url = `${SUPABASE_URL}/rest/v1/support_requests?select=id,type,message,attachment_url,status,created_at,resolved_at,client:clients(name,slug),requester:users(email,name)&order=created_at.desc${filter}`
    const resp = await fetch(url, { headers })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al leer support_requests.` })
      return
    }
    res.status(200).json({ requests: await resp.json() })
  } catch {
    res.status(502).json({ error: 'No se pudo leer support_requests desde Supabase.' })
  }
}

/** action=support-resolve — POST, Header: Authorization: Bearer <token>
 * (admin). Body: { id, status } */
async function handleSupportResolve(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env
  if (!(await requireAdmin(req, res, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET))) return

  const { id, status } = req.body ?? {}
  if (typeof id !== 'number' && typeof id !== 'string') {
    res.status(400).json({ error: 'Falta el campo id.' })
    return
  }
  if (status !== 'abierto' && status !== 'resuelto') {
    res.status(400).json({ error: "El campo status debe ser 'abierto' o 'resuelto'." })
    return
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/support_requests?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status, resolved_at: status === 'resuelto' ? new Date().toISOString() : null }),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al actualizar la incidencia.` })
      return
    }
    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'No se pudo actualizar la incidencia en Supabase.' })
  }
}
