/**
 * Vercel Function: POST /api/admin-login
 * Body: { password }
 * Compara con la variable de entorno ADMIN_PASSWORD (secreto compartido del
 * equipo, no ligado a ningún cliente) y, si es correcta, devuelve un token
 * firmado (válido 12h) para acceder al panel de administración (/admin).
 */
import { timingSafeEqual, createHmac } from 'crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
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
    res.status(500).json({ error: `Error inesperado en /api/admin-login: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }

  const { ADMIN_PASSWORD, AUTH_TOKEN_SECRET } = process.env
  if (!ADMIN_PASSWORD || !AUTH_TOKEN_SECRET) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (ADMIN_PASSWORD, AUTH_TOKEN_SECRET).',
    })
    return
  }

  const { password } = req.body ?? {}
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Falta el campo password.' })
    return
  }

  if (!safeEqual(password, ADMIN_PASSWORD)) {
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' })
    return
  }

  res.status(200).json({ ok: true, token: signToken('admin', AUTH_TOKEN_SECRET) })
}
