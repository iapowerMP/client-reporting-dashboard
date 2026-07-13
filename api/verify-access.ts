/**
 * Vercel Function: POST /api/verify-access
 * Body: { client: slug, password }
 * Comprueba la contraseña del informe de un cliente (clients.access_password_hash)
 * y, si es correcta, devuelve un token firmado (válido 12h) que el navegador
 * guarda y reenvía en el resto de peticiones a /api/* para ese cliente.
 */
import { scryptSync, timingSafeEqual, createHmac } from 'crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

function signToken(subject: string, secret: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS
  const sig = createHmac('sha256', secret).update(`${subject}:${expiry}`).digest('hex')
  return `${expiry}.${sig}`
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/verify-access: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  if (req.method !== 'POST') {
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

  const { client: slug, password } = req.body ?? {}
  if (!slug || typeof password !== 'string') {
    res.status(400).json({ error: 'Faltan campos: client y password son obligatorios.' })
    return
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=access_password_hash`
    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    })
    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al leer el cliente.` })
      return
    }
    const [row] = (await resp.json()) as Array<{ access_password_hash: string | null }>
    if (!row) {
      res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
      return
    }
    if (!row.access_password_hash) {
      res.status(200).json({ ok: true, token: null })
      return
    }
    if (!verifyPassword(password, row.access_password_hash)) {
      res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' })
      return
    }
    res.status(200).json({ ok: true, token: signToken(slug, AUTH_TOKEN_SECRET) })
  } catch {
    res.status(502).json({ error: 'No se pudo comprobar la contraseña en Supabase.' })
  }
}
