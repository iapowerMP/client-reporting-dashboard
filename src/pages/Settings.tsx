import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { UploadCloud, Loader2, Facebook, Chrome } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import StatusBadge from '@/components/shared/StatusBadge'
import Toggle from '@/components/shared/Toggle'
import { useReportConfig } from '@/lib/reportConfig'
import { CONNECTION_CATALOG, type StatusVariant } from '@/data/catalog'
import { type useClientInfo } from '@/lib/useClientInfo'
import { authHeaders, getStoredToken } from '@/lib/authToken'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

/** Plataformas con integración real ya construida (ingesta de datos vía
 * n8n/Supabase). El resto del catálogo existe para poder guardar ya su ID de
 * cuenta, pero no sincroniza nada todavía — el estado debe decirlo con
 * claridad en vez de simular una conexión que no existe. */
const BUILT_INTEGRATIONS = new Set(['google-ads', 'meta-ads', 'ga4', 'gsc', 'facebook', 'instagram', 'youtube'])

/** Plataformas que, además de la conexión manual por API, admiten "iniciar
 * sesión" (OAuth): el propio PM/cliente concede acceso a las cuentas que él
 * mismo administra, sin depender de que estén compartidas con nuestro
 * Business Manager. */
const OAUTH_CAPABLE = new Set(['meta-ads', 'ga4', 'gsc', 'facebook', 'instagram', 'youtube'])

/** Plataformas que SOLO admiten inicio de sesión (sin campo manual de ID). */
const OAUTH_ONLY = new Set(['ga4', 'gsc', 'facebook', 'instagram', 'youtube'])

type OauthPlatform = 'meta' | 'facebook' | 'instagram' | 'ga4' | 'gsc' | 'youtube'

/** Un flujo de "iniciar sesión" por plataforma: sus endpoints y el nombre
 * del campo que espera el finalize. Las integraciones de Meta comparten
 * /api/oauth-facebook (?service=...) y las de Google /api/oauth-google
 * (?service=...) — un único archivo por proveedor para no superar el
 * límite de Serverless Functions del plan de Vercel. */
const OAUTH_CONFIG: Record<
  OauthPlatform,
  { startUrl: string; accountsUrl: string; finalizeUrl: string; finalizeField: string; finalizeExtra?: Record<string, string>; providerLabel: 'Facebook' | 'Google' }
> = {
  meta: {
    startUrl: '/api/oauth-facebook?service=ads&action=start',
    accountsUrl: '/api/oauth-facebook?service=ads&action=accounts',
    finalizeUrl: '/api/oauth-facebook?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'ads' },
    providerLabel: 'Facebook',
  },
  facebook: {
    startUrl: '/api/oauth-facebook?service=page&action=start',
    accountsUrl: '/api/oauth-facebook?service=page&action=accounts',
    finalizeUrl: '/api/oauth-facebook?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'page' },
    providerLabel: 'Facebook',
  },
  instagram: {
    startUrl: '/api/oauth-facebook?service=instagram&action=start',
    accountsUrl: '/api/oauth-facebook?service=instagram&action=accounts',
    finalizeUrl: '/api/oauth-facebook?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'instagram' },
    providerLabel: 'Facebook',
  },
  ga4: {
    startUrl: '/api/oauth-google?service=ga4&action=start',
    accountsUrl: '/api/oauth-google?service=ga4&action=accounts',
    finalizeUrl: '/api/oauth-google?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'ga4' },
    providerLabel: 'Google',
  },
  gsc: {
    startUrl: '/api/oauth-google?service=gsc&action=start',
    accountsUrl: '/api/oauth-google?service=gsc&action=accounts',
    finalizeUrl: '/api/oauth-google?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'gsc' },
    providerLabel: 'Google',
  },
  youtube: {
    startUrl: '/api/oauth-google?service=youtube&action=start',
    accountsUrl: '/api/oauth-google?service=youtube&action=accounts',
    finalizeUrl: '/api/oauth-google?action=finalize',
    finalizeField: 'accountId',
    finalizeExtra: { service: 'youtube' },
    providerLabel: 'Google',
  },
}

/** A qué flujo de login corresponde cada conexión del catálogo. */
const OAUTH_PLATFORM_BY_CONNECTION: Record<string, OauthPlatform> = {
  'meta-ads': 'meta',
  facebook: 'facebook',
  instagram: 'instagram',
  ga4: 'ga4',
  gsc: 'gsc',
  youtube: 'youtube',
}

interface DataSourceRow {
  platform: string
  external_id: string | null
  status: string
  last_sync: string | null
  auth_method?: string
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
  oauthCapable: boolean
  oauthOnly: boolean
  authMethod: 'api' | 'oauth'
  loginProvider: 'Facebook' | 'Google' | null
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
    const oauthCapable = OAUTH_CAPABLE.has(entry.id)
    const oauthOnly = OAUTH_ONLY.has(entry.id)
    const authMethod: 'api' | 'oauth' = row?.auth_method === 'oauth' ? 'oauth' : 'api'
    const loginProvider = oauthCapable ? OAUTH_CONFIG[OAUTH_PLATFORM_BY_CONNECTION[entry.id]].providerLabel : null
    if (!BUILT_INTEGRATIONS.has(entry.id)) {
      return {
        ...entry,
        value,
        status: 'Próximamente',
        statusNote: 'Integración en desarrollo — todavía no sincroniza datos.',
        canSync: false,
        oauthCapable,
        oauthOnly,
        authMethod,
        loginProvider,
      }
    }
    if (value) {
      const via = authMethod === 'oauth' ? ` · conectado con inicio de sesión de ${loginProvider}` : ''
      return {
        ...entry,
        value,
        status: 'Conectado',
        statusNote: `${formatLastSync(row?.last_sync ?? null)}${via}`,
        canSync: true,
        oauthCapable,
        oauthOnly,
        authMethod,
        loginProvider,
      }
    }
    return {
      ...entry,
      value,
      status: 'Pendiente',
      statusNote: oauthOnly
        ? 'Inicia sesión para activar la sincronización.'
        : 'Guarda el identificador de la cuenta para activar la sincronización.',
      canSync: false,
      oauthCapable,
      oauthOnly,
      authMethod,
      loginProvider,
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

/* --------------------- Selector de cuenta (inicio de sesión) -------------- */

interface OauthAccount {
  id: string
  name: string
  active?: boolean
  /** Solo en Instagram: la Página de Facebook a la que está vinculada esa
   * cuenta (necesaria para pedir su token de página al finalizar). */
  pageId?: string
}

function OauthAccountPicker({
  platformLabel,
  loading,
  error,
  accounts,
  selected,
  onSelect,
  confirming,
  onConfirm,
  onCancel,
}: {
  platformLabel: string
  loading: boolean
  error: string | null
  accounts: OauthAccount[] | null
  selected: string
  onSelect: (id: string) => void
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-white">Elige la cuenta de {platformLabel}</h3>
        <p className="mt-1 text-xs text-text-secondary">
          Son las cuentas a las que tiene acceso la cuenta con la que has iniciado sesión.
        </p>

        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {loading && <p className="py-6 text-center text-sm text-text-secondary">Cargando cuentas...</p>}
          {error && <p className="py-6 text-center text-sm text-negative">{error}</p>}
          {!loading && !error && accounts?.length === 0 && (
            <p className="py-6 text-center text-sm text-text-secondary">
              Esa cuenta no administra ninguna cuenta de {platformLabel}.
            </p>
          )}
          {!loading &&
            !error &&
            accounts?.map((acc) => (
              <label
                key={acc.id}
                className="flex cursor-pointer items-center justify-between rounded-control border border-border bg-base px-3 py-2 text-sm text-text-primary hover:border-accent/60"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="oauth-account"
                    checked={selected === acc.id}
                    onChange={() => onSelect(acc.id)}
                  />
                  {acc.name}
                  <span className="text-xs text-text-secondary">({acc.id})</span>
                </span>
                {acc.active === false && <span className="text-xs text-text-secondary">Inactiva</span>}
              </label>
            ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!selected || confirming}
            className="rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {confirming ? 'Conectando...' : 'Conectar esta cuenta'}
          </button>
        </div>
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
  type = 'text',
  step,
  hint,
}: {
  label: string
  defaultValue?: string | number
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement>
  type?: 'text' | 'number'
  step?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">
        {label}
      </span>
      <input
        ref={inputRef}
        type={type}
        step={step}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      {hint && <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>}
    </label>
  )
}

/* --------------------------- Card de conexión ---------------------------- */

const LOGIN_ICON = { Facebook, Google: Chrome } as const

function ConnectionCard({
  conn,
  visible,
  onToggleVisible,
  saving,
  onSaveExternalId,
  syncing,
  onSync,
  onConnectOauth,
}: {
  conn: RealConnection
  visible: boolean
  onToggleVisible: (value: boolean) => void
  saving: boolean
  onSaveExternalId: (value: string) => void
  syncing: boolean
  onSync: () => void
  onConnectOauth: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const LoginIcon = conn.loginProvider ? LOGIN_ICON[conn.loginProvider] : null

  return (
    <div className="rounded-card border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">{conn.platform}</h4>
        <StatusBadge status={conn.status} />
      </div>

      {!conn.oauthOnly && (
        <>
          <div className="mt-4">
            <Field
              label={conn.label}
              defaultValue={conn.value}
              placeholder={conn.placeholder}
              inputRef={inputRef}
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => onSaveExternalId(inputRef.current?.value ?? '')}
              disabled={saving}
              className="rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </>
      )}

      <div className="mt-3 min-h-[18px] text-xs text-text-secondary">
        {conn.statusNote}
      </div>

      {conn.canSync && (
        <div className="mt-3">
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
        </div>
      )}

      {/* Conexión por inicio de sesión: el PM/cliente concede acceso a sus
          propias cuentas, sin depender de que estén compartidas con nuestro
          Business Manager / proyecto de Google. */}
      {conn.oauthCapable && (
        <div className="mt-3 border-t border-border pt-3">
          {!conn.oauthOnly && (
            <p className="mb-2 text-xs text-text-secondary">
              — o conecta iniciando sesión con la cuenta que administra esta cuenta —
            </p>
          )}
          <button
            onClick={onConnectOauth}
            className="inline-flex items-center gap-2 rounded-control border border-border bg-base px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
          >
            {LoginIcon && <LoginIcon className="h-4 w-4" />}
            {conn.authMethod === 'oauth' ? `Reconectar con ${conn.loginProvider}` : `Conectar con ${conn.loginProvider}`}
          </button>
          {conn.loginProvider === 'Facebook' && (
            <p className="mt-2 text-xs text-negative">
              Pendiente de aprobación por Meta: el inicio de sesión con Facebook solo funcionará para cuentas propias del equipo hasta que Meta apruebe los permisos ampliados (App Review).
            </p>
          )}
        </div>
      )}

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
  const [searchParams, setSearchParams] = useSearchParams()
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

  /* ------------------------ Conexión por inicio de sesión ------------------------ */

  const handleConnectOauth = (platform: OauthPlatform) => {
    const token = getStoredToken(clientSlug)
    const url = new URL(OAUTH_CONFIG[platform].startUrl, window.location.origin)
    url.searchParams.set('client', clientSlug)
    if (token) url.searchParams.set('token', token)

    // Se abre en una ventana aparte para no perder la pestaña del informe;
    // al cerrarse (tras completar o cancelar el login) se refresca el estado
    // de las conexiones. Si el navegador bloquea el popup, se cae de vuelta
    // a la redirección en la misma pestaña.
    const popup = window.open(url.toString(), 'mp_oauth_popup', 'width=560,height=720')
    if (!popup) {
      window.location.href = url.toString()
      return
    }
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        loadSources()
      }
    }, 800)
  }

  // Servicio (?service= de cada endpoint) -> plataforma del frontend.
  const FACEBOOK_SERVICE_TO_PLATFORM: Record<string, OauthPlatform> = {
    ads: 'meta',
    page: 'facebook',
    instagram: 'instagram',
  }
  const GOOGLE_SERVICE_TO_PLATFORM: Record<string, OauthPlatform> = {
    ga4: 'ga4',
    gsc: 'gsc',
    youtube: 'youtube',
  }

  // Qué flujo de login está "recogiendo" al usuario tras volver de Facebook/Google:
  // las integraciones de Meta comparten /api/oauth-facebook y redirigen con
  // ?facebook_oauth=<service>; las de Google, /api/oauth-google con
  // ?google_oauth=<service>.
  const activeOauthPlatform: OauthPlatform | null =
    FACEBOOK_SERVICE_TO_PLATFORM[searchParams.get('facebook_oauth') ?? ''] ??
    GOOGLE_SERVICE_TO_PLATFORM[searchParams.get('google_oauth') ?? ''] ??
    null

  const [oauthAccounts, setOauthAccounts] = useState<OauthAccount[] | null>(null)
  const [oauthAccountsLoading, setOauthAccountsLoading] = useState(false)
  const [oauthAccountsError, setOauthAccountsError] = useState<string | null>(null)
  const [selectedOauthAccount, setSelectedOauthAccount] = useState('')
  const [finalizingOauth, setFinalizingOauth] = useState(false)

  useEffect(() => {
    if (!activeOauthPlatform) return
    setOauthAccountsLoading(true)
    setOauthAccountsError(null)
    const accountsUrl = new URL(OAUTH_CONFIG[activeOauthPlatform].accountsUrl, window.location.origin)
    accountsUrl.searchParams.set('client', clientSlug)
    fetch(accountsUrl.toString())
      .then(async (resp) => {
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(body?.error || 'No se pudieron cargar las cuentas.')
        setOauthAccounts(body.accounts ?? [])
      })
      .catch((e) => setOauthAccountsError(e instanceof Error ? e.message : 'No se pudieron cargar las cuentas.'))
      .finally(() => setOauthAccountsLoading(false))
    // Se ejecuta una sola vez al detectar el parámetro de vuelta del login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOauthPlatform])

  const closeOauthPicker = () => {
    // Si esta pestaña es el popup abierto desde el informe, se cierra sola
    // en vez de quedarse mostrando el selector de cuentas vacío.
    if (window.opener) {
      window.close()
      return
    }
    const next = new URLSearchParams(searchParams)
    next.delete('facebook_oauth')
    next.delete('google_oauth')
    setSearchParams(next, { replace: true })
    setOauthAccounts(null)
    setOauthAccountsError(null)
    setSelectedOauthAccount('')
  }

  const handleConfirmOauthAccount = async () => {
    if (!activeOauthPlatform || !selectedOauthAccount) return
    const cfg = OAUTH_CONFIG[activeOauthPlatform]
    const account = oauthAccounts?.find((a) => a.id === selectedOauthAccount)
    setFinalizingOauth(true)
    try {
      const resp = await fetch(cfg.finalizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify({
          client: clientSlug,
          [cfg.finalizeField]: selectedOauthAccount,
          ...cfg.finalizeExtra,
          ...(account?.pageId ? { pageId: account.pageId } : {}),
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body?.error)
      if (window.opener) {
        // Deja ver el mensaje de éxito un instante antes de cerrar el popup;
        // la pestaña del informe detecta el cierre y refresca sola.
        showToast(`Conectado con inicio de sesión de ${cfg.providerLabel}`)
        window.setTimeout(() => window.close(), 1200)
      } else {
        closeOauthPicker()
        await loadSources()
        showToast(`Conectado con inicio de sesión de ${cfg.providerLabel}`)
      }
    } catch (e) {
      setOauthAccountsError(e instanceof Error && e.message ? e.message : 'No se pudo completar la conexión.')
    } finally {
      setFinalizingOauth(false)
    }
  }

  const clientNameRef = useRef<HTMLInputElement>(null)
  const clientSectorRef = useRef<HTMLInputElement>(null)
  const clientWebsiteRef = useRef<HTMLInputElement>(null)
  const clientBusinessTypeRef = useRef<HTMLSelectElement>(null)
  const cplTargetRef = useRef<HTMLInputElement>(null)
  const leadsTargetRef = useRef<HTMLInputElement>(null)
  const roasTargetRef = useRef<HTMLInputElement>(null)
  const revenueTargetRef = useRef<HTMLInputElement>(null)
  const [savingClient, setSavingClient] = useState(false)

  const handleSaveClient = async () => {
    setSavingClient(true)
    try {
      // Los campos de target solo se envían si están montados (el tipo de
      // negocio guardado determina cuáles se muestran) — así no se borra por
      // accidente el target del otro tipo de negocio al cambiar de uno a otro.
      const payload: Record<string, string> = {
        client: clientSlug,
        name: clientNameRef.current?.value ?? '',
        sector: clientSectorRef.current?.value ?? '',
        website: clientWebsiteRef.current?.value ?? '',
        businessType: clientBusinessTypeRef.current?.value ?? '',
      }
      if (cplTargetRef.current) payload.cplTarget = cplTargetRef.current.value
      if (leadsTargetRef.current) payload.leadsTargetMonthly = leadsTargetRef.current.value
      if (roasTargetRef.current) payload.roasTarget = roasTargetRef.current.value
      if (revenueTargetRef.current) payload.revenueTargetMonthly = revenueTargetRef.current.value

      const resp = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders(clientSlug) },
        body: JSON.stringify(payload),
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
          key={`${clientData?.name ?? ''}-${clientData?.sector ?? ''}-${clientData?.website ?? ''}-${clientData?.businessType ?? ''}`}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Nombre del cliente" defaultValue={clientData?.name} inputRef={clientNameRef} />
          <Field label="Sector" defaultValue={clientData?.sector ?? ''} inputRef={clientSectorRef} />
          <Field label="Sitio web" defaultValue={clientData?.website ?? ''} inputRef={clientWebsiteRef} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">
              Tipo de negocio
            </span>
            <select
              ref={clientBusinessTypeRef}
              defaultValue={clientData?.businessType ?? ''}
              className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            >
              <option value="">Sin definir</option>
              <option value="leadgen">Leadgen (generación de leads)</option>
              <option value="ecommerce">Ecommerce (venta online)</option>
            </select>
            <p className="mt-1.5 text-xs text-text-secondary">
              Cambia qué KPIs destaca Paid Media: leads y coste por lead, o
              ventas y ROAS. Guarda para ver los campos de target correspondientes.
            </p>
          </label>
          {clientData?.businessType === 'leadgen' && (
            <>
              <Field
                label="CPL target (€)"
                type="number"
                step="0.01"
                defaultValue={clientData?.cplTarget ?? undefined}
                placeholder="25"
                inputRef={cplTargetRef}
                hint="Coste por lead objetivo — colorea la tabla de campañas y el semáforo."
              />
              <Field
                label="Objetivo de leads / mes"
                type="number"
                step="1"
                defaultValue={clientData?.leadsTargetMonthly ?? undefined}
                placeholder="150"
                inputRef={leadsTargetRef}
                hint="Se prorratea según el rango de fechas del informe."
              />
            </>
          )}
          {clientData?.businessType === 'ecommerce' && (
            <>
              <Field
                label="ROAS target"
                type="number"
                step="0.1"
                defaultValue={clientData?.roasTarget ?? undefined}
                placeholder="4.0"
                inputRef={roasTargetRef}
                hint="Colorea la tabla de campañas y el semáforo."
              />
              <Field
                label="Objetivo de revenue / mes (€)"
                type="number"
                step="0.01"
                defaultValue={clientData?.revenueTargetMonthly ?? undefined}
                placeholder="20000"
                inputRef={revenueTargetRef}
                hint="Se prorratea según el rango de fechas del informe."
              />
            </>
          )}
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
              onConnectOauth={() => handleConnectOauth(OAUTH_PLATFORM_BY_CONNECTION[conn.id])}
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

      {activeOauthPlatform && (
        <OauthAccountPicker
          platformLabel={
            activeOauthPlatform === 'meta'
              ? 'Meta Ads'
              : activeOauthPlatform === 'facebook'
                ? 'Facebook'
                : activeOauthPlatform === 'instagram'
                  ? 'Instagram'
                  : activeOauthPlatform === 'ga4'
                    ? 'Google Analytics 4'
                    : activeOauthPlatform === 'gsc'
                      ? 'Search Console'
                      : 'YouTube'
          }
          loading={oauthAccountsLoading}
          error={oauthAccountsError}
          accounts={oauthAccounts}
          selected={selectedOauthAccount}
          onSelect={setSelectedOauthAccount}
          confirming={finalizingOauth}
          onConfirm={handleConfirmOauthAccount}
          onCancel={closeOauthPicker}
        />
      )}
    </div>
  )
}
