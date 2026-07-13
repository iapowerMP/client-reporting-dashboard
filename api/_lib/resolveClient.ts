/**
 * Resuelve el slug de cliente (de la URL, ?client=acme-corp) al uuid interno
 * en la tabla `clients` de Supabase. Usado por todos los endpoints /api/*
 * que necesitan saber de qué cliente son los datos, ya que el deployment es
 * compartido por todos los clientes (no hay un client_id fijo por servidor).
 */
export async function resolveClientId(
  supabaseUrl: string,
  serviceRoleKey: string,
  slug: string,
): Promise<string | null> {
  const url = `${supabaseUrl}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=id`
  const resp = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })
  if (!resp.ok) return null
  const rows = (await resp.json()) as Array<{ id: string }>
  return rows[0]?.id ?? null
}
