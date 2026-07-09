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

async function fetchJson<T>(endpoint: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(endpoint, { headers: { Accept: 'application/json' } })
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
  getOverview: () => fetchJson<OverviewData>('/api/overview'),
  getPaid: () => fetchJson<PaidData>('/api/paid'),
  getSeo: () => fetchJson<SeoData>('/api/seo'),
  getSocial: () => fetchJson<SocialData>('/api/social'),
  getSettings: () => fetchJson<SettingsData>('/api/settings'),
}
