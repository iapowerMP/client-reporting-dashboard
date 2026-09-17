/**
 * Proveedor de datos: llama a los endpoints server-side (Vercel Functions
 * bajo /api/*) que a su vez consultan Supabase (alimentado por n8n) usando
 * las credenciales del cliente. Los secretos viven en el servidor, nunca en
 * el navegador.
 */
import type { DataProvider, DateRange, OverviewData, PaidData, ProgrammaticData, SeoData, SocialData } from './types'
import { authHeaders, clearToken } from '@/lib/authToken'

async function fetchJson<T>(
  endpoint: string,
  client: string,
  range?: DateRange,
  extraParams?: Record<string, string>,
): Promise<T> {
  const params = new URLSearchParams({ client })
  if (range) {
    params.set('from', range.from)
    params.set('to', range.to)
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) params.set(key, value)
  }
  const url = `${endpoint}?${params.toString()}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders() } })
  } catch {
    throw new Error(
      `No se pudo conectar con ${endpoint}. ¿Está desplegada la función de servidor?`,
    )
  }
  if (res.status === 401) {
    // La sesión ya no es válida (caducada o sin acceso a este informe): se
    // recarga para que ClientLayout vuelva a pedir el login.
    clearToken()
    window.location.reload()
    throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      if (typeof body?.error === 'string') detail = body.error
    } catch {
      /* la respuesta no era JSON; nos quedamos sin detalle */
    }
    throw new Error(
      `El endpoint ${endpoint} respondió ${res.status}${detail ? `: ${detail}` : '.'}`,
    )
  }
  return (await res.json()) as T
}

export const liveProvider: DataProvider = {
  getOverview: (client, range) => fetchJson<OverviewData>('/api/overview', client, range),
  getPaid: (client, range) => fetchJson<PaidData>('/api/paid', client, range),
  // Vive en /api/paid (con ?mode=programmatic) en vez de en un endpoint
  // propio, para no superar el límite de Serverless Functions del plan de
  // Vercel (12) — ver comentario al inicio de api/paid.ts.
  getProgrammatic: (client, range) =>
    fetchJson<ProgrammaticData>('/api/paid', client, range, { mode: 'programmatic' }),
  getSeo: (client, range) => fetchJson<SeoData>('/api/seo', client, range),
  getSocial: (client, range) => fetchJson<SocialData>('/api/social', client, range),
}
