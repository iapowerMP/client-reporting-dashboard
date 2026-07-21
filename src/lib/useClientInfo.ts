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
  hasPassword: boolean
  /** 'leadgen' | 'ecommerce' | null (sin definir todavía) — cambia qué KPIs
   * destaca Paid Media. */
  businessType: 'leadgen' | 'ecommerce' | null
  /** Targets de Paid Media (null = sin definir). cplTarget/leadsTargetMonthly
   * se usan si businessType es 'leadgen'; roasTarget/revenueTargetMonthly si
   * es 'ecommerce'. Los objetivos mensuales se prorratean según el rango de
   * fechas del informe. */
  cplTarget: number | null
  leadsTargetMonthly: number | null
  roasTarget: number | null
  revenueTargetMonthly: number | null
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
          hasPassword: !!row.hasPassword,
          businessType: row.business_type === 'leadgen' || row.business_type === 'ecommerce' ? row.business_type : null,
          cplTarget: typeof row.cpl_target === 'number' ? row.cpl_target : null,
          leadsTargetMonthly: typeof row.leads_target_monthly === 'number' ? row.leads_target_monthly : null,
          roasTarget: typeof row.roas_target === 'number' ? row.roas_target : null,
          revenueTargetMonthly: typeof row.revenue_target_monthly === 'number' ? row.revenue_target_monthly : null,
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
