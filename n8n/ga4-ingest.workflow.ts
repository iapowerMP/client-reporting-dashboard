/**
 * Workflow n8n: "CRD - GA4 to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 * Copia versionada del workflow creado en n8n (SDK @n8n/workflow-sdk).
 *
 * A diferencia de Google Ads y Meta Ads, GA4 solo admite conexión por inicio
 * de sesión (Google): no hay modo API manual con una credencial compartida.
 * El propio project manager/cliente inicia sesión en Configuración
 * (/api/oauth-ga4-*) y elige la propiedad GA4 que él mismo administra; el
 * refresh token queda guardado en `data_sources.oauth_refresh_token`, propio
 * de cada cliente.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento:
 *   1. Schedule (diario, 8:00) → Postgres (lee en Supabase qué clientes
 *      tienen una propiedad GA4 conectada) → uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source cuando el project manager
 *      pulsa "Sincronizar ahora" en Configuración. Recibe { clientId } en el
 *      body (la propiedad y el token siempre se resuelven frescos en
 *      Supabase, nunca se confía en lo que llegue por webhook).
 *
 * Ambas rutas convergen en "Cliente GA4" (solo aporta client_id) →
 * "Buscar propiedad y token" (Postgres: lee de data_sources la propiedad GA4
 * y el refresh token de ese cliente) → "Refrescar token de Google" (HTTP:
 * canjea el refresh token por un access token de ~1h, ya que a diferencia de
 * Meta, Google no permite usar el refresh token directamente en la API) →
 * "Consultar GA4 Data API" (HTTP: sesiones/usuarios/canal por día, últimos
 * 30 días) → Code (transforma la respuesta a un UPSERT SQL + un UPDATE de
 * data_sources.last_sync) → Postgres (ejecuta ambas sentencias).
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con GA4", "Buscar propiedad y
 *     token" y "Upsert en Supabase").
 *
 * En el nodo "Config OAuth Google" hay que rellenar client_id y
 * client_secret: el mismo cliente OAuth de Google Cloud usado por
 * /api/oauth-ga4-* (variables de entorno GOOGLE_OAUTH_CLIENT_ID /
 * GOOGLE_OAUTH_CLIENT_SECRET en Vercel). El client_id no es secreto; el
 * client_secret sí — se escribe aquí directamente en la UI de n8n, nunca en
 * este archivo ni en el repo.
 *
 * Cada fila de ga4_daily se etiqueta con la propiedad (property_id) que la
 * originó. Si un cliente cambia de propiedad GA4, /api/seo y /api/overview
 * filtran siempre por la propiedad actualmente guardada en data_sources.
 *
 * Simplificación actual: sessions/users/newUsers se suman por canal y día;
 * sumar "users" (usuarios únicos) entre canales o días es una aproximación
 * razonable para un V1 pero no exacta (GA4 no permite sumar usuarios únicos
 * sin inflar el total). El refresh token no se revoca ni se refresca de
 * forma proactiva: si el cliente revoca el acceso, la sincronización
 * empezará a fallar y habrá que pedirle que pulse "Reconectar con Google".
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 8 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con GA4',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'ga4' AND external_id IS NOT NULL AND oauth_refresh_token IS NOT NULL",
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [460, 300],
  },
  output: [{ client_id: '' }],
})

const manualSyncWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Sincronizacion manual (webhook)',
    parameters: {
      httpMethod: 'POST',
      path: 'REEMPLAZAR-token-secreto-webhook',
      authentication: 'none',
      responseMode: 'onReceived',
    },
    position: [240, 560],
  },
  output: [{ body: { clientId: '' } }],
})

const normalizeWebhookPayload = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalizar payload webhook',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [{ id: 'w1', name: 'client_id', value: expr('{{ $json.body.clientId }}'), type: 'string' }],
      },
      includeOtherFields: false,
    },
    position: [460, 560],
  },
  output: [{ client_id: '' }],
})

const mergePoint = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cliente GA4',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [] },
      includeOtherFields: true,
    },
    position: [680, 420],
  },
  output: [{ client_id: '' }],
})

const lookupAccount = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Buscar propiedad y token',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS property_id, oauth_refresh_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'ga4'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', property_id: '', oauth_refresh_token: '' }],
})

const oauthConfig = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config OAuth Google',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'g1', name: 'client_id', value: 'REEMPLAZAR-google-oauth-client-id', type: 'string' },
          { id: 'g2', name: 'client_secret', value: 'REEMPLAZAR-google-oauth-client-secret', type: 'string' },
        ],
      },
      includeOtherFields: true,
    },
    position: [1120, 300],
  },
  output: [{ client_id: '', property_id: '', oauth_refresh_token: '', client_secret: '' }],
})

const refreshToken = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Refrescar token de Google',
    parameters: {
      method: 'POST',
      url: 'https://oauth2.googleapis.com/token',
      sendBody: true,
      contentType: 'form-urlencoded',
      specifyBody: 'keypair',
      bodyParameters: {
        parameters: [
          { name: 'grant_type', value: 'refresh_token' },
          { name: 'client_id', value: expr('{{ $json.client_id }}') },
          { name: 'client_secret', value: expr('{{ $json.client_secret }}') },
          { name: 'refresh_token', value: expr('{{ $json.oauth_refresh_token }}') },
        ],
      },
    },
    position: [1340, 300],
  },
  output: [{ access_token: '', expires_in: 3599 }],
})

const fetchGa4 = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Consultar GA4 Data API',
    parameters: {
      method: 'POST',
      url: expr('{{ "https://analyticsdata.googleapis.com/v1beta/" + $("Buscar propiedad y token").item.json.property_id + ":runReport" }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.access_token }}') }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody:
        '{\n  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "today" }],\n  "dimensions": [{ "name": "date" }, { "name": "sessionDefaultChannelGroup" }],\n  "metrics": [{ "name": "sessions" }, { "name": "activeUsers" }, { "name": "newUsers" }, { "name": "engagedSessions" }, { "name": "conversions" }],\n  "limit": 10000\n}',
    },
    position: [1560, 300],
  },
  output: [{ rows: [] }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar propiedad y token').item.json.client_id;
const propertyId = $('Buscar propiedad y token').item.json.property_id;
const resp = $json || {};
const results = resp.rows || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const toIsoDate = (raw) => raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
const rows = results.map((r) => {
  const dims = r.dimensionValues || [];
  const mets = r.metricValues || [];
  return {
    client_id: clientId,
    property_id: propertyId,
    date: toIsoDate(dims[0]?.value || ''),
    channel: dims[1]?.value || 'Unassigned',
    sessions: num(mets[0]?.value),
    users: num(mets[1]?.value),
    new_users: num(mets[2]?.value),
    engaged_sessions: num(mets[3]?.value),
    conversions: num(mets[4]?.value),
  };
});
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'ga4';";
if (rows.length === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.property_id) + ', ' + esc(x.date) + '::date, ' + esc(x.channel) + ', ' +
  x.sessions + ', ' + x.users + ', ' + x.new_users + ', ' + x.engaged_sessions + ', ' + x.conversions + ')'
).join(',');
const upsertQuery =
  'INSERT INTO ga4_daily (client_id, property_id, date, channel, sessions, users, new_users, engaged_sessions, conversions) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, channel) DO UPDATE SET property_id = EXCLUDED.property_id, sessions = EXCLUDED.sessions, users = EXCLUDED.users, new_users = EXCLUDED.new_users, engaged_sessions = EXCLUDED.engaged_sessions, conversions = EXCLUDED.conversions, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: rows.length } };`,
    },
    position: [1780, 300],
  },
  output: [{ query: '', rowCount: 0 }],
})

const upsert = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert en Supabase',
    parameters: { resource: 'database', operation: 'executeQuery', query: expr('{{ $json.query }}') },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [2000, 300],
  },
  output: [{}],
})

export default workflow('ga4-ingest', 'CRD - GA4 to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(oauthConfig)
  .to(refreshToken)
  .to(fetchGa4)
  .to(transform)
  .to(upsert)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
