/**
 * Gestión del token de acceso por cliente (informes protegidos con
 * contraseña). El token lo emite /api/verify-access y se guarda en
 * localStorage; el servidor lo valida en cada petición sensible.
 */
const tokenKey = (slug: string) => `mp-token:${slug}`

export function getStoredToken(slug: string): string | null {
  const token = localStorage.getItem(tokenKey(slug))
  if (!token) return null
  const [expiryStr] = token.split('.')
  const expiry = Number(expiryStr)
  if (!expiry || Date.now() > expiry) {
    localStorage.removeItem(tokenKey(slug))
    return null
  }
  return token
}

export function storeToken(slug: string, token: string) {
  localStorage.setItem(tokenKey(slug), token)
}

export function clearToken(slug: string) {
  localStorage.removeItem(tokenKey(slug))
}

/** Cabecera Authorization lista para spread en fetch(), vacía si no hay token. */
export function authHeaders(slug: string): Record<string, string> {
  const token = getStoredToken(slug)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
