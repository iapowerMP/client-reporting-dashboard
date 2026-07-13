import { useRef, useState, type ChangeEvent } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { RefreshCw, UploadCloud, Loader2 } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import DataTable, { type Column } from '@/components/shared/DataTable'
import StatusBadge from '@/components/shared/StatusBadge'
import Toggle from '@/components/shared/Toggle'
import { useReportConfig } from '@/lib/reportConfig'
import { cn } from '@/lib/utils'
import { type Connection, type SyncLog } from '@/data/mockData'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { type useClientInfo } from '@/lib/useClientInfo'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

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
  syncing,
  onSync,
  visible,
  onToggleVisible,
  saving,
  onSaveExternalId,
}: {
  conn: Connection
  syncing: boolean
  onSync: () => void
  visible: boolean
  onToggleVisible: (value: boolean) => void
  saving: boolean
  onSaveExternalId: (value: string) => void
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

      <div className="mt-3 min-h-[18px] text-xs">
        {conn.status === 'Error' && conn.errorMessage ? (
          <span className="text-negative">{conn.errorMessage}</span>
        ) : conn.lastSync === 'Nunca' ? (
          <span className="text-text-secondary">Nunca sincronizado</span>
        ) : (
          <span className="text-text-secondary">
            Última sincronización: {conn.lastSync}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onSaveExternalId(inputRef.current?.value ?? '')}
          disabled={saving}
          className="rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
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
            'Sincronizar'
          )}
        </button>
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

/* ------------------------------ Tabla de logs ---------------------------- */

const logColumns: Column<SyncLog>[] = [
  { key: 'fechaHora', header: 'Fecha/Hora', sortable: true },
  { key: 'plataforma', header: 'Plataforma', sortable: true },
  {
    key: 'estado',
    header: 'Estado',
    sortable: true,
    render: (r) => (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-sm',
          r.estado === 'Completado' ? 'text-positive' : 'text-negative',
        )}
      >
        {r.estado === 'Completado' ? '✅' : '❌'} {r.estado}
      </span>
    ),
  },
  { key: 'registros', header: 'Registros', align: 'right' },
  { key: 'duracion', header: 'Duración', align: 'right' },
]

/* -------------------------------- Página --------------------------------- */

export default function Settings() {
  const { clientSlug = '' } = useParams()
  const clientInfo = useOutletContext<ReturnType<typeof useClientInfo>>()
  const { isVisible, setVisible } = useReportConfig()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getSettings(clientSlug),
    [clientSlug],
  )
  const [toast, setToast] = useState<string | null>(null)
  const [syncingIds, setSyncingIds] = useState<string[]>([])
  const [savingIds, setSavingIds] = useState<string[]>([])
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3000)
  }

  const handleSaveExternalId = async (platform: string, externalId: string) => {
    setSavingIds((prev) => [...prev, platform])
    try {
      const resp = await fetch('/api/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: clientSlug, platform, externalId }),
      })
      if (!resp.ok) throw new Error()
      showToast('Guardado correctamente')
    } catch {
      showToast('No se pudo guardar. Revisa la configuración del servidor (Supabase).')
    } finally {
      setSavingIds((prev) => prev.filter((x) => x !== platform))
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: clientSlug,
          name: clientNameRef.current?.value ?? '',
          sector: clientSectorRef.current?.value ?? '',
          website: clientWebsiteRef.current?.value ?? '',
        }),
      })
      if (!resp.ok) throw new Error()
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
        headers: { 'Content-Type': 'application/json' },
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

  const handleSyncAll = () => {
    showToast('Sincronización iniciada para todas las plataformas')
  }

  const handleSyncOne = (id: string) => {
    if (syncingIds.includes(id)) return
    setSyncingIds((prev) => [...prev, id])
    window.setTimeout(() => {
      setSyncingIds((prev) => prev.filter((x) => x !== id))
      showToast('Sincronización completada')
    }, 2000)
  }

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const { connections, syncLogs } = data
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

      {/* Conexiones */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Conexiones</h2>
          <button
            onClick={handleSyncAll}
            className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" />
            Sincronizar todo
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              syncing={syncingIds.includes(conn.id)}
              onSync={() => handleSyncOne(conn.id)}
              visible={isVisible(conn.id)}
              onToggleVisible={(v) => setVisible(conn.id, v)}
              saving={savingIds.includes(conn.id)}
              onSaveExternalId={(value) => handleSaveExternalId(conn.id, value)}
            />
          ))}
        </div>
      </div>

      {/* Log de sincronizaciones */}
      <ChartCard title="Historial de sincronizaciones" noPadding>
        <DataTable columns={logColumns} data={syncLogs} rowKey={(_, i) => i} />
      </ChartCard>

      {toast && <Toast message={toast} />}
    </div>
  )
}
