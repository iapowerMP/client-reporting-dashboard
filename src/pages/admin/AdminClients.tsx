import { useEffect, useState } from 'react'
import { ExternalLink, Settings as SettingsIcon } from 'lucide-react'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { authHeaders } from '@/lib/authToken'

interface AdminClient {
  id: string
  name: string
  slug: string
  sector: string | null
  website: string | null
  createdAt: string
  platforms: string[]
}

/** Admin → Clientes: todos los informes configurados. */
export default function AdminClients() {
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const resp = await fetch('/api/admin?action=clients', { headers: authHeaders() })
        if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
        const body = await resp.json()
        if (!cancelled) setClients(body.clients ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los clientes.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} />
  if (!clients) return null

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase text-text-secondary">
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Sector</th>
            <th className="px-4 py-3 font-medium">Integraciones</th>
            <th className="px-4 py-3 font-medium">Creado</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <p className="font-semibold text-white">{c.name}</p>
                <p className="text-xs text-text-secondary">/c/{c.slug}</p>
              </td>
              <td className="px-4 py-3 text-text-secondary">{c.sector ?? '—'}</td>
              <td className="px-4 py-3 text-text-secondary">{c.platforms.length ? c.platforms.join(', ') : '—'}</td>
              <td className="px-4 py-3 text-text-secondary">{new Date(c.createdAt).toLocaleDateString('es-ES')}</td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <a
                    href={`/c/${c.slug}`}
                    className="inline-flex items-center gap-1 rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Ver
                  </a>
                  <a
                    href={`/c/${c.slug}/settings`}
                    className="inline-flex items-center gap-1 rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" /> Configurar
                  </a>
                </div>
              </td>
            </tr>
          ))}
          {clients.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-text-secondary">
                Todavía no hay clientes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
