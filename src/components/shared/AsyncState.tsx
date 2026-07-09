import { Loader2, AlertTriangle } from 'lucide-react'

/** Estado de carga centrado para una vista o sección. */
export function Loading({ label = 'Cargando datos…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-text-secondary">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  )
}

/** Estado de error con mensaje explicativo. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertTriangle className="h-6 w-6 text-negative" />
      <p className="max-w-md text-sm text-text-secondary">{message}</p>
    </div>
  )
}
