/**
 * Vercel Function: POST /api/upload-logo
 * Body: { client: slug, filename: string, dataUrl: string }  (dataUrl = "data:<mime>;base64,<...>")
 * Sube el archivo al bucket público "logos" de Supabase Storage y guarda su
 * URL pública en clients.logo_url. Devuelve { logoUrl }.
 *
 * Si el cliente tiene contraseña activada, exige el token de sesión
 * (Authorization: Bearer <token>, emitido por /api/verify-access).
 */
import { timingSafeEqual, createHmac } from 'crypto'

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

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/upload-logo: ${(e as Error).message}` })
  }
}

async function handleRequest(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' })
    return
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      error: 'Faltan variables de entorno en el servidor (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
    })
    return
  }

  const { client: slug, filename, dataUrl } = req.body ?? {}
  if (!slug || !filename || !dataUrl) {
    res.status(400).json({ error: 'Faltan campos: client, filename y dataUrl son obligatorios.' })
    return
  }

  const clientResp = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=access_password_hash`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  )
  if (!clientResp.ok) {
    res.status(502).json({ error: `Supabase respondió ${clientResp.status} al leer el cliente.` })
    return
  }
  const [clientRow] = (await clientResp.json()) as Array<{ access_password_hash: string | null }>
  if (!clientRow) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }
  if (clientRow.access_password_hash) {
    const authHeader = req.headers?.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const secret = process.env.AUTH_TOKEN_SECRET
    if (!secret || !token || !verifyToken(token, slug, secret)) {
      res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
      return
    }
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) {
    res.status(400).json({ error: 'El archivo no llegó en el formato esperado.' })
    return
  }
  const [, contentType, base64] = match
  const bytes = Buffer.from(base64, 'base64')

  const ext = (filename.split('.').pop() || 'png').toLowerCase()
  const path = `${slug}-${Date.now()}.${ext}`

  const uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
    },
    body: bytes,
  })
  if (!uploadResp.ok) {
    res.status(502).json({ error: `Supabase Storage respondió ${uploadResp.status} al subir el logo.` })
    return
  }

  const logoUrl = `${SUPABASE_URL}/storage/v1/object/public/logos/${path}`

  const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ logo_url: logoUrl }),
  })
  if (!patchResp.ok) {
    res.status(502).json({ error: `Supabase respondió ${patchResp.status} al guardar logo_url.` })
    return
  }

  res.status(200).json({ logoUrl })
}
