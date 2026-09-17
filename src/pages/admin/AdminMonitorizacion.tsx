import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { authHeaders } from '@/lib/authToken'
import { cn } from '@/lib/utils'

type RunStatus = 'Completado' | 'Error'

interface SyncRun {
  id: number
  client_id: string
  platform: string
  status: RunStatus
  records: number
  duration_s: number | null
  error_message: string | null
  ran_at: string
  client: { name: string; slug: string } | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchRuns(onlyErrors: boolean): Promise<SyncRun[]> {
  const query = onlyErrors ? '&status=Error' : ''
  const resp = await fetch(`/api/admin?action=sync-status${query}`, { headers: authHeaders() })
  if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
  const body = await resp.json()
  return body.runs ?? []
}

/** Admin → Monitorización: últimas sincronizaciones automáticas (n8n) de
 * todos los clientes, para detectar fallos. Sin aviso proactivo por ahora
 * (solo dentro del panel) — se puede añadir más adelante. */
export default function AdminMonitorizacion() {
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [runs, setRuns] = useState<SyncRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (filterErrors: boolean) => {
    setLoading(true)
    setError(null)
    try {
      setRuns(await fetchRuns(filterErrors))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las sincronizaciones.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(onlyErrors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyErrors])

  const errorCount = runs?.filter((r) => r.status === 'Error').length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Últimas 200 ejecuciones registradas por n8n, de todos los clientes.
          {!onlyErrors && errorCount > 0 && (
            <span className="ml-2 text-negative">
              {errorCount} con error.
            </span>
          )}
        </p>
        <button
          onClick={() => setOnlyErrors((v) => !v)}
          className={cn(
            'rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
            onlyErrors
              ? 'border-negative/60 bg-negative/10 text-negative'
              : 'border-border text-text-secondary hover:text-white',
          )}
        >
          {onlyErrors ? 'Ver todas' : 'Ver solo fallos'}
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorState message={error} />}

      {runs && (
        <div className="overflow-x-auto rounded-card border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-text-secondary">
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Plataforma</th>
                <th className="px-4 py-3 font-medium">Registros</th>
                <th className="px-4 py-3 font-medium">Duración</th>
                <th className="px-4 py-3 font-medium">Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {r.status === 'Error' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-negative">
                        <AlertTriangle className="h-3.5 w-3.5" /> Error
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-positive">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Completado
                      </span>
                    )}
                    {r.status === 'Error' && r.error_message && (
                      <p className="mt-1 max-w-xs truncate text-xs text-text-secondary" title={r.error_message}>
                        {r.error_message}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-primary">{r.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{r.platform}</td>
                  <td className="px-4 py-3 text-text-secondary">{r.records}</td>
                  <td className="px-4 py-3 text-text-secondary">{r.duration_s != null ? `${r.duration_s}s` : '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(r.ran_at)}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-text-secondary">
                    Todavía no hay sincronizaciones registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
