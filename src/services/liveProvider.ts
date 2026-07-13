/**
 * Proveedor de datos reales. Llama a endpoints server-side (Vercel Functions
 * bajo /api/*) que a su vez consultan las APIs de cada plataforma usando las
 * credenciales del cliente. Los secretos viven en el servidor, nunca en el
 * navegador.
 *
 * ⚠️ Los endpoints /api/* todavía no están implementados. Mientras no existan,
 * este proveedor devolverá un error claro (visible como estado de error en la
 * vista). Se irán implementando plataforma por plataforma.
 */
import type {
  DataProvider,
  OverviewData,
  PaidData,
  SeoData,
  SocialData,
  SettingsData,
} from './types'

async function fetchJson<T>(endpoint: string, client: string): Promise<T> {
  const url = `${endpoint}?client=${encodeURIComponent(client)}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error(
      `No se pudo conectar con ${endpoint}. ¿Está desplegada la función de servidor?`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `El endpoint ${endpoint} respondió ${res.status}. Revisa las credenciales de la fuente en Configuración.`,
    )
  }
  return (await res.json()) as T
}

export const liveProvider: DataProvider = {
  mode: 'live',
  getOverview: (client) => fetchJson<OverviewData>('/api/overview', client),
  getPaid: (client) => fetchJson<PaidData>('/api/paid', client),
  getSeo: (client) => fetchJson<SeoData>('/api/seo', client),
  getSocial: (client) => fetchJson<SocialData>('/api/social', client),
  getSettings: (client) => fetchJson<SettingsData>('/api/settings', client),
}
