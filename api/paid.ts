/**
 * Vercel Function: GET /api/paid?client=<slug>
 * Lee las métricas diarias de Google Ads desde Supabase (tabla
 * gads_campaign_daily) y las agrega en la forma que espera PaidData
 * (src/services/types.ts). Meta Ads y TikTok Ads se añadirán del mismo modo
 * cuando tengan su propia tabla / integración.
 *
 * El deployment es compartido por todos los clientes: el cliente se resuelve
 * en cada petición a partir del slug de la URL (?client=), no de una variable
 * de entorno fija.
 *
 * Variables de entorno requeridas (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { timingSafeEqual, createHmac } from 'crypto'

async function resolveClient(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
): Promise<{ id: string; access_password_hash: string | null } | null> {
  const url = `${supabaseUrl}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id,access_password_hash`
  const resp = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!resp.ok) return null
  const rows = (await resp.json()) as Array<{ id: string; access_password_hash: string | null }>
  return rows[0] ?? null
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

function checkAccess(req: any, client: { access_password_hash: string | null }, slug: string): boolean {
  if (!client.access_password_hash) return true
  const authHeader = req.headers?.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secret = process.env.AUTH_TOKEN_SECRET
  return !!secret && !!token && verifyToken(token, slug, secret)
}

interface GadsRow {
  date: string
  campaign_id: string
  campaign_name: string
  status: string
  cost: string | number
  impressions: string | number
  clicks: string | number
  conversions: string | number
  conversions_value: string | number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function formatDateLabel(iso: string) {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

export default async function handler(req: any, res: any) {
  try {
    await handleRequest(req, res)
  } catch (e) {
    res.status(500).json({ error: `Error inesperado en /api/paid: ${(e as Error).message}` })
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

  const slug = typeof req.query?.client === 'string' ? req.query.client : ''
  if (!slug) {
    res.status(400).json({ error: 'Falta el parámetro client en la petición.' })
    return
  }

  let client: { id: string; access_password_hash: string | null } | null
  try {
    client = await resolveClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, slug)
  } catch (e) {
    res.status(502).json({ error: `No se pudo resolver el cliente: ${(e as Error).message}` })
    return
  }
  if (!client) {
    res.status(404).json({ error: `No existe ningún cliente con el identificador "${slug}".` })
    return
  }
  if (!checkAccess(req, client, slug)) {
    res.status(401).json({ error: 'Este informe está protegido con contraseña. Vuelve a introducirla.' })
    return
  }

  const from = typeof req.query?.from === 'string' ? req.query.from : ''
  const to = typeof req.query?.to === 'string' ? req.query.to : ''

  const query = new URLSearchParams({
    client_id: `eq.${client.id}`,
    order: 'date.asc',
  })
  // PostgREST admite repetir la misma columna para acotar un rango (AND).
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('date', `gte.${from}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('date', `lte.${to}`)

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/gads_campaign_daily?${query.toString()}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })

    if (!resp.ok) {
      res.status(502).json({ error: `Supabase respondió ${resp.status} al consultar gads_campaign_daily.` })
      return
    }

    const rows = (await resp.json()) as GadsRow[]

    const byCampaign = new Map<
      string,
      { name: string; status: string; cost: number; impressions: number; clicks: number; conversions: number; conversionsValue: number }
    >()
    const byDate = new Map<string, { inversion: number; conversiones: number }>()

    for (const r of rows) {
      const campaign = byCampaign.get(r.campaign_id) ?? {
        name: r.campaign_name,
        status: r.status,
        cost: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionsValue: 0,
      }
      campaign.status = r.status
      campaign.cost += Number(r.cost)
      campaign.impressions += Number(r.impressions)
      campaign.clicks += Number(r.clicks)
      campaign.conversions += Number(r.conversions)
      campaign.conversionsValue += Number(r.conversions_value)
      byCampaign.set(r.campaign_id, campaign)

      const day = byDate.get(r.date) ?? { inversion: 0, conversiones: 0 }
      day.inversion += Number(r.cost)
      day.conversiones += Number(r.conversions)
      byDate.set(r.date, day)
    }

    const campaigns = Array.from(byCampaign.values()).map((c) => ({
      platform: 'Google Ads' as const,
      name: c.name,
      status: c.status === 'ENABLED' || c.status === 'Activa' ? ('Activa' as const) : ('Pausada' as const),
      inversion: round2(c.cost),
      impresiones: c.impressions,
      clics: c.clicks,
      ctr: c.impressions ? round2((c.clicks / c.impressions) * 100) : 0,
      cpc: c.clicks ? round2(c.cost / c.clicks) : 0,
      conversiones: round2(c.conversions),
      roas: c.cost ? round2(c.conversionsValue / c.cost) : 0,
    }))

    const invConv = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => ({
        date: formatDateLabel(date),
        inversion: round2(v.inversion),
        conversiones: round2(v.conversiones),
      }))

    const totalInversion = round2(campaigns.reduce((s, c) => s + c.inversion, 0))
    const distribution = totalInversion
      ? [{ name: 'Google Ads', value: totalInversion, percent: '100,0%', color: '#34A853' }]
      : []

    const topRoas = [...campaigns]
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 5)
      .map((c) => ({ name: c.name, roas: c.roas }))

    res.status(200).json({ campaigns, invConv, distribution, topRoas })
  } catch {
    res.status(502).json({ error: 'No se pudo leer Google Ads desde Supabase.' })
  }
}
