/**
 * Vercel Function: POST /api/upload-logo
 * Body: { client: slug, filename: string, dataUrl: string }  (dataUrl = "data:<mime>;base64,<...>")
 * Sube el archivo al bucket público "logos" de Supabase Storage y guarda su
 * URL pública en clients.logo_url. Devuelve { logoUrl }.
 */

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
