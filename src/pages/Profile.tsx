import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useSession } from '@/lib/session'
import Login from './Login'
import { Loading } from '@/components/shared/AsyncState'

const inputClass =
  'w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40'

/** Perfil: cualquier usuario logueado puede cambiar su propio nombre y
 * contraseña, sin pasar por un admin. */
export default function Profile() {
  const session = useSession()

  if (session.loading) return <Loading />
  if (!session.user || session.user.mustChangePassword) return <Login />

  return <ProfileForm />
}

function ProfileForm() {
  const session = useSession()
  const user = session.user!

  const [name, setName] = useState(user.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)

  const [currentlyChangingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault()
    setSavingName(true)
    setNameError(null)
    setNameSaved(false)
    const result = await session.updateProfile(name.trim())
    setSavingName(false)
    if (!result.ok) setNameError(result.error)
    else setNameSaved(true)
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSaved(false)
    if (newPassword.length < 8) {
      setPasswordError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== newPassword2) {
      setPasswordError('Las contraseñas no coinciden.')
      return
    }
    setChangingPassword(true)
    const result = await session.changePassword(newPassword)
    setChangingPassword(false)
    if (!result.ok) {
      setPasswordError(result.error)
    } else {
      setPasswordSaved(true)
      setNewPassword('')
      setNewPassword2('')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link to="/" className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-white">Perfil</h1>
          <p className="text-sm text-text-secondary">{user.email}</p>
        </div>

        <form onSubmit={handleSaveName} className="rounded-card border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Nombre</h2>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameSaved(false)
            }}
            placeholder="Tu nombre"
            className={`${inputClass} mb-3`}
          />
          {nameError && <p className="mb-3 text-xs text-negative">{nameError}</p>}
          {nameSaved && <p className="mb-3 text-xs text-positive">Guardado.</p>}
          <button
            type="submit"
            disabled={savingName}
            className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {savingName ? 'Guardando...' : 'Guardar nombre'}
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="rounded-card border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Cambiar contraseña</h2>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              setPasswordSaved(false)
            }}
            placeholder="Nueva contraseña (mínimo 8 caracteres)"
            className={`${inputClass} mb-3`}
          />
          <input
            type="password"
            value={newPassword2}
            onChange={(e) => {
              setNewPassword2(e.target.value)
              setPasswordSaved(false)
            }}
            placeholder="Repite la contraseña"
            className={`${inputClass} mb-3`}
          />
          {passwordError && <p className="mb-3 text-xs text-negative">{passwordError}</p>}
          {passwordSaved && <p className="mb-3 text-xs text-positive">Contraseña actualizada.</p>}
          <button
            type="submit"
            disabled={currentlyChangingPassword}
            className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {currentlyChangingPassword ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
