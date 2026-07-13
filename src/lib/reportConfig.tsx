import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { connections } from '@/data/mockData'

/**
 * Configuración del informe: controla qué fuentes de datos (plataformas)
 * son visibles en el dashboard. El estado se persiste en localStorage para
 * que las preferencias del usuario sobrevivan a recargas.
 */

type VisibilityMap = Record<string, boolean>

/** Cada cliente tiene su propia preferencia, para no mezclarlas en un
 * deployment compartido por varios clientes. */
const storageKey = (clientSlug: string) => `mp-report-visibility:${clientSlug}`

/** Por defecto: visibles las conexiones "Conectado"; ocultas las demás. */
function defaultVisibility(): VisibilityMap {
  const map: VisibilityMap = {}
  for (const c of connections) {
    map[c.id] = c.status === 'Conectado'
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
}: {
  children: ReactNode
  clientSlug: string
}) {
  const [visibility, setVisibility] = useState<VisibilityMap>(() => {
    const defaults = defaultVisibility()
    try {
      const raw = localStorage.getItem(storageKey(clientSlug))
      if (raw) return { ...defaults, ...(JSON.parse(raw) as VisibilityMap) }
    } catch {
      /* almacenamiento no disponible: usar defaults */
    }
    return defaults
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(clientSlug), JSON.stringify(visibility))
    } catch {
      /* ignorar errores de escritura */
    }
  }, [clientSlug, visibility])

  const value = useMemo<ReportConfigValue>(
    () => ({
      visibility,
      isVisible: (id) => visibility[id] ?? false,
      setVisible: (id, val) =>
        setVisibility((prev) => ({ ...prev, [id]: val })),
    }),
    [visibility],
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
