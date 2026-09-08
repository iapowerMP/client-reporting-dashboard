import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { CONNECTION_CATALOG } from '@/data/catalog'
import { authHeaders } from '@/lib/authToken'

/**
 * Configuración del informe: controla qué fuentes de datos (plataformas)
 * son visibles en el dashboard. Se guarda en Supabase (clients.report_
 * visibility) en vez de localStorage: así la ve igual cualquiera que abra
 * el informe, no solo quien la configuró en su propio navegador.
 */

type VisibilityMap = Record<string, boolean>

/** Por defecto todas las conexiones del catálogo son visibles; el PM las
 * oculta manualmente si no quiere mostrarlas en el informe (independiente de
 * si ya están conectadas o no — eso lo indica cada vista con su propio
 * estado "Pendiente"/"Próximamente"). */
function defaultVisibility(): VisibilityMap {
  const map: VisibilityMap = {}
  for (const c of CONNECTION_CATALOG) {
    map[c.id] = true
  }
  return map
}

interface ReportConfigValue {
  visibility: VisibilityMap
  isVisible: (connectionId: string) => boolean
  setVisible: (connectionId: string, value: boolean) => void
}

const ReportConfigContext = createContext<ReportConfigValue | null>(null)

export function ReportConfigProvider({
  children,
  clientSlug,
  initialVisibility,
}: {
  children: ReactNode
  clientSlug: string
  /** Preferencias ya guardadas en Supabase (clients.report_visibility),
   * cargadas por ClientLayout antes de montar este provider; null si el
   * cliente todavía no tiene ninguna guardada. */
  initialVisibility: VisibilityMap | null
}) {
  const [visibility, setVisibility] = useState<VisibilityMap>(() => ({
    ...defaultVisibility(),
    ...(initialVisibility ?? {}),
  }))
  const latestRef = useRef(visibility)
  latestRef.current = visibility

  const persist = useCallback(
    (map: VisibilityMap) => {
      fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, reportVisibility: map }),
      }).catch(() => {
        /* si falla el guardado, el cambio queda solo en esta sesión */
      })
    },
    [clientSlug],
  )

  const value = useMemo<ReportConfigValue>(
    () => ({
      visibility,
      isVisible: (id) => visibility[id] ?? false,
      setVisible: (id, val) => {
        const next = { ...latestRef.current, [id]: val }
        setVisibility(next)
        persist(next)
      },
    }),
    [visibility, persist],
  )

  return (
    <ReportConfigContext.Provider value={value}>
      {children}
    </ReportConfigContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReportConfig(): ReportConfigValue {
  const ctx = useContext(ReportConfigContext)
  if (!ctx) {
    throw new Error('useReportConfig debe usarse dentro de ReportConfigProvider')
  }
  return ctx
}
