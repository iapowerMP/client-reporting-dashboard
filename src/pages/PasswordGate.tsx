import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { storeToken } from '@/lib/authToken'

/** Pantalla que bloquea el acceso a un informe protegido con contraseña. */
export default function PasswordGate({
  slug,
  clientName,
  onUnlock,
}: {
  slug: string
  clientName?: string
  onUnlock: () => void
}) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: slug, password }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body.token) {
        setError(body.error ?? 'Contraseña incorrecta.')
        return
      }
      storeToken(slug, body.token)
      onUnlock()
    } catch {
      setError('No se pudo comprobar la contraseña. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card border border-border bg-card p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
            <Lock className="h-4 w-4 text-black" />
          </span>
          <span className="text-base font-bold text-white">
            {clientName ?? 'Informe protegido'}
          </span>
        </div>
        <p className="mb-4 text-sm text-text-secondary">
          Este informe requiere contraseña para acceder.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className="mb-3 w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        {error && <p className="mb-3 text-xs text-negative">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? 'Comprobando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
