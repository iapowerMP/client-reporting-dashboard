/**
 * Vercel Function: /api/auth?action=login|change-password|me|touch
 * Autenticación de usuarios con cuenta propia (sustituye a la contraseña
 * compartida por informe de /api/verify-access y a la contraseña única de
 * equipo de /api/admin?action=login). Cada persona tiene una fila en
 * `users` con un rol ('admin' | 'project_manager' | 'cliente') y, salvo que
 * sea admin (acceso implícito a todo), una fila por informe permitido en
 * `user_client_access`.
 *
 *   - action=login            (POST) Body: { email, password }. Devuelve un
 *     token firmado (válido 12h) + el rol + si debe cambiar la contraseña.
 *   - action=change-password  (POST) Header: Authorization: Bearer <token>.
 *     Body: { newPassword }. Re-hashea y desmarca must_change_password.
 *   - action=me               (GET)  Header: Authorization: Bearer <token>.
 *     Devuelve el usuario y los informes a los que tiene acceso (todos, si
 *     es admin).
 *   - action=touch             (POST) Header: Authorization: Bearer <token>.
 *     Body: { clientId }. Actualiza user_client_access.last_viewed_at — se
 *     llama una vez al entrar a un informe, para saber qué cliente usa más
 *     o menos cada persona (Admin → Usuarios).
 *
 * El token es distinto del esquema antiguo (que solo probaba "conozco el
 * secreto de este slug/admin"): aquí necesitamos saber DE QUIÉN es el token
 * sin que quien pregunta (p. ej. action=me) tenga que decírnoslo antes, así
 * que el propio id de usuario va dentro del token, firmado:
 *   base64url("<userId>.<expiry>.<hmac-sha256(secret, "userId:expiry")>")
 */
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const MIN_PASSWORD_LENGTH = 8

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function signUserToken(userId: string, secret: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS
  const sig = createHmac('sha256', secret).update(`${userId}:${expiry}`).digest('hex')
  return Buffer.from(`${userId}.${expiry}.${sig}`).toString('base64url')
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

function bearerToken(req: any): string {
  const authHeader = req.headers?.authorization ?? ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}

export default async function handler(req: any, res: any) {
  const action = typeof req.query?.action === 'string' ? req.query.action : ''
  try {
    switch (action) {
      case 'login':
        return await handleLogin(req, res)
      case 'change-password':
        return await handleChangePassword(req, res)
      case 'me':
        return await handleMe(req, res)
      case 'touch':
        return await handleTouch(req, res)
      default:
        res.status(400).json({ error: 'Falta o es inválido el parámetro action.' })
    }
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/auth: ${(e as Error).message}` })
  }
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

/** action=login — POST { email, password } */
async function handleLogin(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env

  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Faltan campos: email y password son obligatorios.' })
    return
  }

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,password_hash,role,must_change_password`,
      { headers },
    )
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al leer users.` })
      return
    }
    const [user] = (await resp.json()) as Array<{
      id: string
      password_hash: string
      role: string
      must_change_password: boolean
    }>
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos.' })
      return
    }

    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_login_at: new Date().toISOString() }),
    })

    res.status(200).json({
      ok: true,
      token: signUserToken(user.id, AUTH_TOKEN_SECRET),
      role: user.role,
      mustChangePassword: user.must_change_password,
    })
  } catch {
    res.status(502).json({ error: 'No se pudo comprobar las credenciales en Supabase.' })
  }
}

/** action=change-password — POST, Header: Authorization: Bearer <token>. Body: { newPassword } */
async function handleChangePassword(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env

  const userId = verifyUserToken(bearerToken(req), AUTH_TOKEN_SECRET)
  if (!userId) {
    res.status(401).json({ error: 'No autorizado.' })
    return
  }

  const { newPassword } = req.body ?? {}
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` })
    return
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ password_hash: hashPassword(newPassword), must_change_password: false }),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al actualizar la contraseña.` })
      return
    }
    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'No se pudo actualizar la contraseña en Supabase.' })
  }
}

/** action=me — GET, Header: Authorization: Bearer <token> */
async function handleMe(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env

  const userId = verifyUserToken(bearerToken(req), AUTH_TOKEN_SECRET)
  if (!userId) {
    res.status(401).json({ error: 'No autorizado.' })
    return
  }

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  try {
    const userResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,email,name,role,must_change_password`,
      { headers },
    )
    if (!userResp.ok) {
      res.status(502).json({ error: `Supabase respondió ${userResp.status} al leer users.` })
      return
    }
    const [user] = (await userResp.json()) as Array<{
      id: string
      email: string
      name: string | null
      role: string
      must_change_password: boolean
    }>
    if (!user) {
      res.status(401).json({ error: 'No autorizado.' })
      return
    }

    let clients: Array<{ id: string; slug: string; name: string; lastViewedAt: string | null }>
    if (user.role === 'admin') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=id,slug,name&order=name.asc`, { headers })
      const rows = resp.ok ? ((await resp.json()) as Array<{ id: string; slug: string; name: string }>) : []
      clients = rows.map((c) => ({ ...c, lastViewedAt: null }))
    } else {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/user_client_access?user_id=eq.${userId}&select=last_viewed_at,client:clients(id,slug,name)`,
        { headers },
      )
      const rows = resp.ok
        ? ((await resp.json()) as Array<{ last_viewed_at: string | null; client: { id: string; slug: string; name: string } | null }>)
        : []
      clients = rows.filter((r) => r.client).map((r) => ({ ...r.client!, lastViewedAt: r.last_viewed_at }))
    }

    res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.must_change_password,
      clients,
    })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Supabase.' })
  }
}

/** action=touch — POST, Header: Authorization: Bearer <token>. Body: { clientId } */
async function handleTouch(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }
  const env = requiredEnv(res)
  if (!env) return
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_TOKEN_SECRET } = env

  const userId = verifyUserToken(bearerToken(req), AUTH_TOKEN_SECRET)
  if (!userId) {
    res.status(401).json({ error: 'No autorizado.' })
    return
  }

  const { clientId } = req.body ?? {}
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ error: 'Falta el campo clientId.' })
    return
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/user_client_access?on_conflict=user_id,client_id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{ user_id: userId, client_id: clientId, last_viewed_at: new Date().toISOString() }]),
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al actualizar user_client_access.` })
      return
    }
    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'No se pudo actualizar Supabase.' })
  }
}
