import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from './authToken'

/** Datos reales del cliente (tabla `clients` de Supabase), independientes de
 * si el resto del dashboard está en modo mock o live. */
export interface ClientInfo {
  id: string
  name: string
  slug: string
  sector: string | null
  website: string | null
  logoUrl: string | null
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
  /** 'standard' (por defecto) usa Overview/Paid/SEO/Social con las fuentes
   * conectadas normales; 'programmatic' sustituye todo el informe por el
   * apartado de publicidad programática (datos importados manualmente). */
  reportTemplate: 'standard' | 'programmatic'
  /** Qué conexiones (por id de CONNECTION_CATALOG) se muestran en el
   * informe — null si aún no se ha guardado ninguna preferencia (todas
   * visibles por defecto). Guardado en Supabase para que sea igual para
   * cualquiera que abra el informe. */
  reportVisibility: Record<string, boolean> | null
  /** Grupo empresarial (Configuración → "Grupo empresarial"): null si el
   * cliente no pertenece a ninguno. `siblings` son las otras empresas del
   * mismo grupo, para el selector de "cambiar de empresa" del sidebar. */
  group: { id: string; name: string; siblings: Array<{ name: string; slug: string }> } | null
}

interface ClientInfoState {
  data: ClientInfo | null
  loading: boolean
  error: string | null
  /** true si la URL no corresponde a ningún cliente — distinto de un error
   * de red o de falta de acceso, para poder avisar con un mensaje claro en
   * vez de mostrar el informe vacío (afecta incluso a un admin, que si no
   * tendría "acceso implícito" a un cliente que ni siquiera existe). */
  notFound: boolean
}

export function useClientInfo(clientSlug: string) {
  const [state, setState] = useState<ClientInfoState>({
    data: null,
    loading: true,
    error: null,
    notFound: false,
  })

  const refetch = useCallback(async () => {
    if (!clientSlug) return
    setState((s) => ({ ...s, loading: true, error: null, notFound: false }))
    try {
      const res = await fetch(`/api/clients?slug=${encodeURIComponent(clientSlug)}`, {
        headers: { Accept: 'application/json', ...authHeaders() },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setState({
          data: null,
          loading: false,
          error: body.error ?? `El servidor respondió ${res.status}`,
          notFound: res.status === 404,
        })
        return
      }
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
          businessType: row.business_type === 'leadgen' || row.business_type === 'ecommerce' ? row.business_type : null,
          cplTarget: typeof row.cpl_target === 'number' ? row.cpl_target : null,
          leadsTargetMonthly: typeof row.leads_target_monthly === 'number' ? row.leads_target_monthly : null,
          roasTarget: typeof row.roas_target === 'number' ? row.roas_target : null,
          revenueTargetMonthly: typeof row.revenue_target_monthly === 'number' ? row.revenue_target_monthly : null,
          reportTemplate: row.report_template === 'programmatic' ? 'programmatic' : 'standard',
          reportVisibility:
            row.report_visibility && typeof row.report_visibility === 'object' ? row.report_visibility : null,
          group: row.group ?? null,
        },
        loading: false,
        error: null,
        notFound: false,
      })
    } catch (e) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : 'No se pudo cargar el cliente.',
        notFound: false,
      })
    }
  }, [clientSlug])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { ...state, refetch }
}
