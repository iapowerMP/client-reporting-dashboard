import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { useAsyncData } from '@/lib/useAsyncData'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

interface ClientSummary {
  id: string
  name: string
  slug: string
  sector: string | null
}

async function fetchClients(): Promise<ClientSummary[]> {
  const res = await fetch('/api/clients', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('No se pudo conectar con /api/clients. ¿Está configurado Supabase?')
  const body = await res.json()
  return body.clients ?? []
}

async function createClient(name: string, sector: string): Promise<ClientSummary> {
  const res = await fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sector }),
  })
  if (!res.ok) throw new Error('No se pudo crear el cliente.')
  const body = await res.json()
  return body.client
}

export default function ClientPicker() {
  const navigate = useNavigate()
  const { data, loading, error } = useAsyncData(fetchClients)
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const client = await createClient(name.trim(), sector.trim())
      navigate(`/c/${client.slug}`)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'No se pudo crear el cliente.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
            <span className="text-sm font-extrabold text-black">M</span>
          </span>
          <span className="text-lg font-extrabold tracking-tight text-white">
            MEDIA POWER
          </span>
        </div>

        <h1 className="mb-1 text-2xl font-bold text-white">Selecciona un cliente</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Cada cliente tiene su propio informe en una URL fija que puedes guardar en favoritos.
        </p>

        {loading && <Loading />}
        {error && <ErrorState message={error} />}

        {data && (
          <div className="mb-6 space-y-2">
            {data.length === 0 && (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-text-secondary">
                Todavía no hay clientes. Crea el primero abajo.
              </p>
            )}
            {data.map((c) => (
              <a
                key={c.id}
                href={`/c/${c.slug}`}
                className="flex items-center justify-between rounded-card border border-border bg-card p-4 transition-colors hover:bg-white/[0.03]"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{c.name}</p>
                  <p className="text-xs text-text-secondary">
                    {c.sector ?? 'Sin sector'} · /c/{c.slug}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-text-secondary" />
              </a>
            ))}
          </div>
        )}

        <div className="rounded-card border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Crear cliente nuevo</h2>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del cliente"
              className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Sector (opcional)"
              className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {createError && <p className="text-xs text-negative">{createError}</p>}
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Creando...' : 'Crear cliente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
