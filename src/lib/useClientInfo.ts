import { useCallback, useEffect, useState } from 'react'

/** Datos reales del cliente (tabla `clients` de Supabase), independientes de
 * si el resto del dashboard está en modo mock o live. */
export interface ClientInfo {
  id: string
  name: string
  slug: string
  sector: string | null
  website: string | null
  logoUrl: string | null
}

interface ClientInfoState {
  data: ClientInfo | null
  loading: boolean
  error: string | null
}

export function useClientInfo(clientSlug: string) {
  const [state, setState] = useState<ClientInfoState>({
    data: null,
    loading: true,
    error: null,
  })

  const refetch = useCallback(async () => {
    if (!clientSlug) return
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/clients?slug=${encodeURIComponent(clientSlug)}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`)
      const body = await res.json()
      const row = body.client
      setState({
        data: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          sector: row.sector,
          website: row.website,
          logoUrl: row.logo_url,
        },
        loading: false,
        error: null,
      })
    } catch (e) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : 'No se pudo cargar el cliente.',
      })
    }
  }, [clientSlug])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { ...state, refetch }
}
