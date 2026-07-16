/**
 * Proveedor de datos: llama a los endpoints server-side (Vercel Functions
 * bajo /api/*) que a su vez consultan Supabase (alimentado por n8n) usando
 * las credenciales del cliente. Los secretos viven en el servidor, nunca en
 * el navegador.
 */
import type { DataProvider, DateRange, OverviewData, PaidData, SeoData, SocialData } from './types'
import { authHeaders, clearToken } from '@/lib/authToken'

async function fetchJson<T>(endpoint: string, client: string, range?: DateRange): Promise<T> {
  const params = new URLSearchParams({ client })
  if (range) {
    params.set('from', range.from)
    params.set('to', range.to)
  }
  const url = `${endpoint}?${params.toString()}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders(client) } })
  } catch {
    throw new Error(
      `No se pudo conectar con ${endpoint}. ¿Está desplegada la función de servidor?`,
    )
  }
  if (res.status === 401) {
    // El informe está protegido y el token guardado ya no es válido: se
    // recarga para que ClientLayout vuelva a pedir la contraseña.
    clearToken(client)
    window.location.reload()
    throw new Error('Este informe está protegido con contraseña. Vuelve a introducirla.')
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
  getSeo: (client, range) => fetchJson<SeoData>('/api/seo', client, range),
  getSocial: (client, range) => fetchJson<SocialData>('/api/social', client, range),
}
