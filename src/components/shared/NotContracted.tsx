import { PackageX } from 'lucide-react'

/** Se muestra en vez de una sección entera cuando el cliente no tiene ninguna
 * fuente de esa categoría activada en Configuración — evita mostrar gráficos
 * vacíos o con ceros como si el servicio estuviera contratado. */
export default function NotContracted({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <PackageX className="h-6 w-6 text-text-secondary" />
      <p className="max-w-md text-sm text-text-secondary">
        Este cliente no tiene {label} contratado o activado. Actívalo en
        Configuración → Conexiones cuando corresponda.
      </p>
    </div>
  )
}
