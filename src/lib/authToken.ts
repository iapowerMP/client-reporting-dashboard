/**
 * Sesión de usuario (login con email/contraseña vía /api/auth). Token único
 * y global — ya no hay una contraseña distinta por informe: con una sola
 * cuenta se accede a todos los informes que el admin le haya asignado
 * (Admin → Usuarios). El token es opaco para el navegador (viaja firmado);
 * si ha caducado, el servidor responde 401 y la sesión se cierra sola (ver
 * `src/lib/session.tsx`).
 */
const TOKEN_KEY = 'mp-user-token'

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function storeToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/** Cabecera Authorization lista para spread en fetch(), vacía si no hay sesión. */
export function authHeaders(): Record<string, string> {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
