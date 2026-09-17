import { useEffect, useState } from 'react'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { authHeaders } from '@/lib/authToken'
import { cn } from '@/lib/utils'

type RequestStatus = 'abierto' | 'resuelto'
type RequestType = 'ayuda' | 'error'

interface SupportRequest {
  id: number
  type: RequestType
  message: string
  attachment_url: string | null
  status: RequestStatus
  created_at: string
  resolved_at: string | null
  client: { name: string; slug: string } | null
  requester: { email: string; name: string | null } | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchRequests(status: RequestStatus | 'todos'): Promise<SupportRequest[]> {
  const query = status === 'todos' ? '' : `&status=${status}`
  const resp = await fetch(`/api/admin?action=support-list${query}`, { headers: authHeaders() })
  if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
  const body = await resp.json()
  return body.requests ?? []
}

/** Admin → Incidencias: peticiones de ayuda/error enviadas desde los
 * informes, con su adjunto si lo hay. */
export default function AdminIncidencias() {
  const [filter, setFilter] = useState<RequestStatus | 'todos'>('abierto')
  const [requests, setRequests] = useState<SupportRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const load = async (status: RequestStatus | 'todos') => {
    setLoading(true)
    setError(null)
    try {
      setRequests(await fetchRequests(status))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las incidencias.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const toggleStatus = async (r: SupportRequest) => {
    const nextStatus: RequestStatus = r.status === 'abierto' ? 'resuelto' : 'abierto'
    setUpdatingId(r.id)
    try {
      const resp = await fetch('/api/admin?action=support-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: r.id, status: nextStatus }),
      })
      if (!resp.ok) throw new Error()
      await load(filter)
    } catch {
      setError('No se pudo actualizar la incidencia.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['abierto', 'resuelto', 'todos'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-control border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              filter === f
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-border text-text-secondary hover:text-white',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <ErrorState message={error} />}

      {requests && (
        <div className="space-y-3">
          {requests.length === 0 && (
            <p className="rounded-card border border-dashed border-border p-4 text-sm text-text-secondary">
              No hay incidencias {filter !== 'todos' ? `en estado "${filter}"` : ''}.
            </p>
          )}
          {requests.map((r) => (
            <div key={r.id} className="rounded-card border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-control px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                      r.type === 'error' ? 'bg-negative/15 text-negative' : 'bg-accent/15 text-accent',
                    )}
                  >
                    {r.type === 'error' ? 'Error' : 'Ayuda'}
                  </span>
                  <span className="text-sm font-semibold text-white">{r.client?.name ?? 'Cliente eliminado'}</span>
                  <span className="text-xs text-text-secondary">
                    · {r.requester?.name || r.requester?.email || 'Usuario eliminado'}
                  </span>
                </div>
                <span className="text-xs text-text-secondary">{formatDate(r.created_at)}</span>
              </div>
              <p className="mb-3 whitespace-pre-wrap text-sm text-text-primary">{r.message}</p>
              {r.attachment_url && (
                <a href={r.attachment_url} target="_blank" rel="noreferrer" className="mb-3 block">
                  <img
                    src={r.attachment_url}
                    alt="Adjunto"
                    className="max-h-48 rounded-control border border-border object-contain"
                  />
                </a>
              )}
              <button
                onClick={() => toggleStatus(r)}
                disabled={updatingId === r.id}
                className={cn(
                  'rounded-control border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                  r.status === 'abierto'
                    ? 'border-border text-text-primary hover:bg-white/5'
                    : 'border-border text-text-secondary hover:bg-white/5',
                )}
              >
                {updatingId === r.id ? 'Guardando...' : r.status === 'abierto' ? 'Marcar como resuelto' : 'Reabrir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
