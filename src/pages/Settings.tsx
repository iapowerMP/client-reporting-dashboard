import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { UploadCloud, Loader2 } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import StatusBadge from '@/components/shared/StatusBadge'
import Toggle from '@/components/shared/Toggle'
import { useReportConfig } from '@/lib/reportConfig'
import { CONNECTION_CATALOG, type StatusVariant } from '@/data/mockData'
import { type useClientInfo } from '@/lib/useClientInfo'
import { authHeaders } from '@/lib/authToken'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

/** Plataformas con integración real ya construida (ingesta de datos vía
 * n8n/Supabase). El resto del catálogo existe para poder guardar ya su ID de
 * cuenta, pero no sincroniza nada todavía — el estado debe decirlo con
 * claridad en vez de simular una conexión que no existe. */
const BUILT_INTEGRATIONS = new Set(['google-ads'])

interface DataSourceRow {
  platform: string
  external_id: string | null
  status: string
  last_sync: string | null
}

interface RealConnection {
  id: string
  platform: string
  label: string
  placeholder: string
  value: string
  status: StatusVariant
  statusNote: string
  canSync: boolean
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Aún no se ha sincronizado.'
  const d = new Date(iso)
  return `Última sincronización: ${d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function buildRealConnections(sources: DataSourceRow[]): RealConnection[] {
  const byPlatform = new Map(sources.map((s) => [s.platform, s]))
  return CONNECTION_CATALOG.map((entry) => {
    const row = byPlatform.get(entry.id)
    const value = row?.external_id ?? ''
    if (!BUILT_INTEGRATIONS.has(entry.id)) {
      return {
        ...entry,
        value,
        status: 'Próximamente',
        statusNote: 'Integración en desarrollo — todavía no sincroniza datos.',
        canSync: false,
      }
    }
    if (value) {
      return {
        ...entry,
        value,
        status: 'Conectado',
        statusNote: formatLastSync(row?.last_sync ?? null),
        canSync: true,
      }
    }
    return {
      ...entry,
      value,
      status: 'Pendiente',
      statusNote: 'Guarda el identificador de la cuenta para activar la sincronización.',
      canSync: false,
    }
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/* ----------------------------- Toast simple ------------------------------ */

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-[fadeIn_0.2s_ease-out] rounded-card border border-border bg-card px-4 py-3 text-sm text-white shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-accent" />
        {message}
      </div>
    </div>
  )
}

/* ----------------------------- Campos de form ---------------------------- */

function Field({
  label,
  defaultValue,
  placeholder,
  inputRef,
}: {
  label: string
  defaultValue?: string
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement>
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
      </span>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </label>
  )
}

/* --------------------------- Card de conexión ---------------------------- */

function ConnectionCard({
  conn,
  visible,
  onToggleVisible,
  saving,
  onSaveExternalId,
  syncing,
  onSync,
}: {
  conn: RealConnection
  visible: boolean
  onToggleVisible: (value: boolean) => void
  saving: boolean
  onSaveExternalId: (value: string) => void
  syncing: boolean
  onSync: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">{conn.platform}</h4>
        <StatusBadge status={conn.status} />
      </div>

      <div className="mt-4">
        <Field
          label={conn.label}
          defaultValue={conn.value}
          placeholder={conn.placeholder}
          inputRef={inputRef}
        />
      </div>

      <div className="mt-3 min-h-[18px] text-xs text-text-secondary">
        {conn.statusNote}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onSaveExternalId(inputRef.current?.value ?? '')}
          disabled={saving}
          className="rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        {conn.canSync && (
          <button
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sincronizando
              </>
            ) : (
              'Sincronizar ahora'
            )}
          </button>
        )}
      </div>

      {/* Visibilidad en el informe */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-text-secondary">
          Mostrar en el informe
        </span>
        <Toggle
          checked={visible}
          onChange={onToggleVisible}
          label={`Mostrar ${conn.platform} en el informe`}
        />
      </div>
    </div>
  )
}

/* -------------------------------- Página --------------------------------- */

export default function Settings() {
  const { clientSlug = '' } = useParams()
  const navigate = useNavigate()
  const clientInfo = useOutletContext<ReturnType<typeof useClientInfo>>()
  const { isVisible, setVisible } = useReportConfig()
  const [sources, setSources] = useState<DataSourceRow[] | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<string[]>([])
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    setSourcesError(null)
    try {
      const resp = await fetch(`/api/data-sources?client=${encodeURIComponent(clientSlug)}`, {
        headers: { Accept: 'application/json', ...authHeaders(clientSlug) },
      })
      if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
      const body = await resp.json()
      setSources(body.sources ?? [])
    } catch (e) {
      setSourcesError(
        e instanceof Error ? e.message : 'No se pudieron cargar las conexiones.',
      )
    } finally {
      setSourcesLoading(false)
    }
  }, [clientSlug])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3000)
  }

  const handleSaveExternalId = async (platform: string, externalId: string) => {
    setSavingIds((prev) => [...prev, platform])
    try {
      const resp = await fetch('/api/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, platform, externalId }),
      })
      if (!resp.ok) throw new Error()
      await loadSources()
      showToast('Guardado correctamente')
    } catch {
      showToast('No se pudo guardar. Revisa la configuración del servidor (Supabase).')
    } finally {
      setSavingIds((prev) => prev.filter((x) => x !== platform))
    }
  }

  const [syncingIds, setSyncingIds] = useState<string[]>([])

  const handleSync = async (platform: string) => {
    setSyncingIds((prev) => [...prev, platform])
    try {
      const resp = await fetch('/api/sync-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, platform }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body?.error)
      showToast('Sincronización iniciada')
      // La sincronización corre en segundo plano en n8n; se comprueba el
      // resultado un par de veces para reflejar el estado real sin recargar.
      window.setTimeout(loadSources, 3000)
      window.setTimeout(loadSources, 8000)
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'No se pudo iniciar la sincronización.')
    } finally {
      setSyncingIds((prev) => prev.filter((x) => x !== platform))
    }
  }

  const clientNameRef = useRef<HTMLInputElement>(null)
  const clientSectorRef = useRef<HTMLInputElement>(null)
  const clientWebsiteRef = useRef<HTMLInputElement>(null)
  const [savingClient, setSavingClient] = useState(false)

  const handleSaveClient = async () => {
    setSavingClient(true)
    try {
      const resp = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({
          client: clientSlug,
          name: clientNameRef.current?.value ?? '',
          sector: clientSectorRef.current?.value ?? '',
          website: clientWebsiteRef.current?.value ?? '',
        }),
      })
      if (!resp.ok) throw new Error()
      const body = await resp.json()
      const newSlug: string | undefined = body?.client?.slug
      if (newSlug && newSlug !== clientSlug) {
        showToast('Guardado — la URL del informe ha cambiado')
        navigate(`/c/${newSlug}/settings`, { replace: true })
        return
      }
      await clientInfo.refetch()
      showToast('Guardado correctamente')
    } catch {
      showToast('No se pudo guardar. Revisa la configuración del servidor (Supabase).')
    } finally {
      setSavingClient(false)
    }
  }

  const handleLogoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_LOGO_BYTES) {
      showToast('El archivo pesa demasiado (máximo 2 MB).')
      return
    }
    setUploadingLogo(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resp = await fetch('/api/upload-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, filename: file.name, dataUrl }),
      })
      if (!resp.ok) throw new Error()
      await clientInfo.refetch()
      showToast('Logo actualizado')
    } catch {
      showToast('No se pudo subir el logo. Revisa la configuración del servidor (Supabase).')
    } finally {
      setUploadingLogo(false)
    }
  }

  const [passwordValue, setPasswordValue] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const handleSetPassword = async () => {
    if (!passwordValue.trim()) return
    setSavingPassword(true)
    try {
      const resp = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, password: passwordValue.trim() }),
      })
      if (!resp.ok) throw new Error()
      setPasswordValue('')
      await clientInfo.refetch()
      showToast('Contraseña activada')
    } catch {
      showToast('No se pudo guardar la contraseña.')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleRemovePassword = async () => {
    setSavingPassword(true)
    try {
      const resp = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({ client: clientSlug, removePassword: true }),
      })
      if (!resp.ok) throw new Error()
      await clientInfo.refetch()
      showToast('Contraseña desactivada')
    } catch {
      showToast('No se pudo quitar la contraseña.')
    } finally {
      setSavingPassword(false)
    }
  }

  if (sourcesLoading) return <Loading />
  if (sourcesError || !sources)
    return <ErrorState message={sourcesError ?? 'No se pudieron cargar las conexiones.'} />

  const realConnections = buildRealConnections(sources)
  const clientData = clientInfo.data

  return (
    <div className="space-y-6">
      {/* Datos del cliente */}
      <ChartCard title="Datos del cliente">
        <div
          key={`${clientData?.name ?? ''}-${clientData?.sector ?? ''}-${clientData?.website ?? ''}`}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Nombre del cliente" defaultValue={clientData?.name} inputRef={clientNameRef} />
          <Field label="Sector" defaultValue={clientData?.sector ?? ''} inputRef={clientSectorRef} />
          <Field label="Sitio web" defaultValue={clientData?.website ?? ''} inputRef={clientWebsiteRef} />
          <div>
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">
              Logo
            </span>
            <div className="flex items-center gap-3">
              {clientData?.logoUrl && (
                <img
                  src={clientData.logoUrl}
                  alt="Logo"
                  className="h-[42px] w-[42px] shrink-0 rounded-control border border-border object-cover"
                />
              )}
              <label className="flex h-[42px] flex-1 cursor-pointer items-center gap-2 rounded-control border border-dashed border-border bg-base px-3 text-sm text-text-secondary transition-colors hover:border-accent/60">
                <UploadCloud className="h-4 w-4" />
                {uploadingLogo ? 'Subiendo...' : 'Arrastra o selecciona un archivo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingLogo}
                  onChange={handleLogoChange}
                />
              </label>
            </div>
            <p className="mt-1.5 text-xs text-text-secondary">
              Recomendado: imagen cuadrada de al menos 128×128 px (PNG con fondo
              transparente) — se muestra como icono redondeado arriba a la
              izquierda del dashboard. Máximo 2 MB.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <button
            onClick={handleSaveClient}
            disabled={savingClient}
            className="rounded-control border border-border bg-base px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
          >
            {savingClient ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </ChartCard>

      {/* Seguridad del informe */}
      <ChartCard title="Seguridad del informe">
        <p className="mb-3 text-sm text-text-secondary">
          {clientData?.hasPassword
            ? 'Este informe está protegido con contraseña. Solo quien la conozca puede verlo.'
            : 'Este informe es visible para cualquiera que tenga el enlace. Añade una contraseña para restringir el acceso.'}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="password"
            value={passwordValue}
            onChange={(e) => setPasswordValue(e.target.value)}
            placeholder={clientData?.hasPassword ? 'Nueva contraseña' : 'Establecer contraseña'}
            className="w-full max-w-xs rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSetPassword}
              disabled={savingPassword || !passwordValue.trim()}
              className="rounded-control border border-border bg-base px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
            >
              {clientData?.hasPassword ? 'Cambiar contraseña' : 'Activar contraseña'}
            </button>
            {clientData?.hasPassword && (
              <button
                onClick={handleRemovePassword}
                disabled={savingPassword}
                className="rounded-control border border-border bg-base px-4 py-2 text-sm font-medium text-negative transition-colors hover:bg-negative/10 disabled:opacity-60"
              >
                Quitar contraseña
              </button>
            )}
          </div>
        </div>
      </ChartCard>

      {/* Conexiones */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Conexiones</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {realConnections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              visible={isVisible(conn.id)}
              onToggleVisible={(v) => setVisible(conn.id, v)}
              saving={savingIds.includes(conn.id)}
              onSaveExternalId={(value) => handleSaveExternalId(conn.id, value)}
              syncing={syncingIds.includes(conn.id)}
              onSync={() => handleSync(conn.id)}
            />
          ))}
        </div>
      </div>

      {/* Log de sincronizaciones */}
      <ChartCard title="Historial de sincronizaciones">
        <p className="py-4 text-center text-sm text-text-secondary">
          El historial detallado de sincronizaciones estará disponible próximamente.
        </p>
      </ChartCard>

      {toast && <Toast message={toast} />}
    </div>
  )
}
