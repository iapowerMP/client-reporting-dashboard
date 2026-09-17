import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { useSession } from '@/lib/session'

const inputClass =
  'mb-3 w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40'

/** Pantalla de login (email + contraseña) para todo el dashboard, y flujo de
 * cambio de contraseña obligatorio en el primer acceso de una cuenta creada
 * por un admin. No necesita saber para qué informe se usa: la sesión es
 * global (ver src/lib/session.tsx). */
export default function Login({ subtitle }: { subtitle?: string }) {
  const { user, login, changePassword } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user?.mustChangePassword) {
    const handleChangePassword = async (e: FormEvent) => {
      e.preventDefault()
      setError(null)
      if (newPassword.length < 8) {
        setError('La contraseña debe tener al menos 8 caracteres.')
        return
      }
      if (newPassword !== newPassword2) {
        setError('Las contraseñas no coinciden.')
        return
      }
      setLoading(true)
      const result = await changePassword(newPassword)
      setLoading(false)
      if (!result.ok) setError(result.error)
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <form onSubmit={handleChangePassword} className="w-full max-w-sm rounded-card border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
              <Lock className="h-4 w-4 text-black" />
            </span>
            <span className="text-base font-bold text-white">Establece tu contraseña</span>
          </div>
          <p className="mb-4 text-sm text-text-secondary">
            Por seguridad, antes de continuar tienes que establecer tu propia contraseña.
          </p>
          <input
            type="password"
            autoFocus
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Nueva contraseña (mínimo 8 caracteres)"
            className={inputClass}
          />
          <input
            type="password"
            value={newPassword2}
            onChange={(e) => setNewPassword2(e.target.value)}
            placeholder="Repite la contraseña"
            className={inputClass}
          />
          {error && <p className="mb-3 text-xs text-negative">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? 'Guardando...' : 'Guardar y continuar'}
          </button>
        </form>
      </div>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)
    const result = await login(email.trim(), password)
    setLoading(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
            <span className="text-sm font-extrabold text-black">M</span>
          </span>
          <span className="text-base font-bold text-white">MEDIA POWER</span>
        </div>
        <p className="mb-4 text-sm text-text-secondary">{subtitle ?? 'Inicia sesión con tu cuenta.'}</p>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          className={inputClass}
        />
        {error && <p className="mb-3 text-xs text-negative">{error}</p>}
        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
