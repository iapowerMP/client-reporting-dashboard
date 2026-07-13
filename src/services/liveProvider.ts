/**
 * Proveedor de datos reales. Llama a endpoints server-side (Vercel Functions
 * bajo /api/*) que a su vez consultan las APIs de cada plataforma usando las
 * credenciales del cliente. Los secretos viven en el servidor, nunca en el
 * navegador.
 *
 * Las integraciones se activan una a una. Mientras un endpoint concreto no
 * exista todavía (404), esa vista cae automáticamente a los datos de mentira
 * en vez de mostrar un error — así se puede activar VITE_DATA_MODE=live para
 * todo el dashboard aunque, de momento, solo Google Ads tenga datos reales.
 * Un error real del servidor (500, fallo de red, etc.) sí se muestra.
 */
import type {
  DataProvider,
  OverviewData,
  PaidData,
  SeoData,
  SocialData,
  SettingsData,
} from './types'
import { mockProvider } from './mockProvider'

class EndpointNotImplemented extends Error {}

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
  if (res.status === 404) {
    throw new EndpointNotImplemented()
  }
  if (!res.ok) {
    throw new Error(
      `El endpoint ${endpoint} respondió ${res.status}. Revisa las credenciales de la fuente en Configuración.`,
    )
  }
  return (await res.json()) as T
}

/** Si el endpoint aún no existe, usa el mock correspondiente; cualquier otro
 * error se propaga tal cual para mostrarse en la vista. */
async function withMockFallback<T>(promise: Promise<T>, mockFn: () => Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (e) {
    if (e instanceof EndpointNotImplemented) return mockFn()
    throw e
  }
}

export const liveProvider: DataProvider = {
  mode: 'live',
  getOverview: (client) =>
    withMockFallback(fetchJson<OverviewData>('/api/overview', client), () =>
      mockProvider.getOverview(client),
    ),
  getPaid: (client) => fetchJson<PaidData>('/api/paid', client),
  getSeo: (client) =>
    withMockFallback(fetchJson<SeoData>('/api/seo', client), () => mockProvider.getSeo(client)),
  getSocial: (client) =>
    withMockFallback(fetchJson<SocialData>('/api/social', client), () =>
      mockProvider.getSocial(client),
    ),
  getSettings: (client) =>
    withMockFallback(fetchJson<SettingsData>('/api/settings', client), () =>
      mockProvider.getSettings(client),
    ),
}
