import { useState, type FormEvent } from 'react'
import { LifeBuoy, X } from 'lucide-react'
import { authHeaders } from '@/lib/authToken'
import { cn } from '@/lib/utils'

const MAX_BYTES = 2 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Botón flotante presente en todos los informes: formulario de "pedir
 * ayuda" o "reportar un error", con una imagen adjunta opcional. Lo recibe
 * el equipo en Admin → Incidencias. El usuario/cliente que envía se deduce
 * de la sesión — no hace falta pedirlo, porque entrar a un informe ya
 * exige estar logueado. */
export default function SupportForm({ clientId }: { clientId?: string }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<'ayuda' | 'error'>('ayuda')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (!clientId) return null

  const handleFile = (f: File | null) => {
    setError(null)
    if (f && f.size > MAX_BYTES) {
      setError('El archivo pesa demasiado (máximo 2 MB).')
      return
    }
    setFile(f)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    setError(null)
    try {
      const attachmentDataUrl = file ? await readFileAsDataUrl(file) : undefined
      const resp = await fetch('/api/admin?action=support-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clientId, type, message: message.trim(), attachmentDataUrl }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body.error ?? 'No se pudo enviar el mensaje.')
      setSent(true)
      setMessage('')
      setFile(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true)
          setSent(false)
        }}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-black shadow-lg transition-opacity hover:opacity-90"
      >
        <LifeBuoy className="h-4 w-4" />
        Ayuda
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">¿Necesitas ayuda?</h2>
              <button onClick={() => setOpen(false)} className="text-text-secondary hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {sent ? (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                  Gracias, hemos recibido tu mensaje. Te responderemos lo antes posible.
                </p>
                <button
                  onClick={() => setOpen(false)}
                  className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="flex gap-2">
                  {(['ayuda', 'error'] as const).map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setType(t)}
                      className={cn(
                        'rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
                        type === t
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-border text-text-secondary hover:text-white',
                      )}
                    >
                      {t === 'ayuda' ? 'Pedir ayuda' : 'Reportar un error'}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Cuéntanos qué necesitas..."
                  rows={4}
                  className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <label className="block text-xs text-text-secondary">
                  Adjuntar una imagen (opcional, máximo 2 MB)
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    className="mt-1.5 block w-full text-xs text-text-secondary file:mr-3 file:rounded-control file:border file:border-border file:bg-base file:px-3 file:py-1.5 file:text-xs file:text-text-primary"
                  />
                </label>
                {error && <p className="text-xs text-negative">{error}</p>}
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {sending ? 'Enviando...' : 'Enviar'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
