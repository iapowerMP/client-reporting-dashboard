/**
 * Workflow n8n: "CRD - Facebook Page to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * Facebook (Página) solo admite conexión por inicio de sesión (sin modo API
 * manual): el PM/cliente inicia sesión en Configuración
 * (/api/oauth-facebook?service=page) y elige la Página que administra; al
 * finalizar, el backend canjea el token de usuario por el TOKEN DE PÁGINA
 * (de mayor duración) y lo guarda en `data_sources.oauth_access_token` — este
 * workflow lo usa directamente, sin credencial compartida de n8n.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento
 * (mismo patrón que Meta Ads/GA4/Search Console):
 *   1. Schedule (diario, 8:00) → Postgres (clientes con Página conectada) →
 *      uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId } en el
 *      body (la página y el token siempre se resuelven frescos en Supabase).
 *
 * Ambas rutas convergen en "Cliente Facebook" → "Buscar pagina y token"
 * (Postgres) → "Seguidores de la pagina" (HTTP: fan_count, snapshot actual)
 * + "Calcular rango de fechas" (últimos 30 días) → "Insights de la pagina"
 * (HTTP: page_impressions/page_engaged_users por día) → "Transformar a SQL
 * upsert" → Postgres.
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con Facebook", "Buscar pagina y
 *     token", "Upsert en Supabase").
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_FACEBOOK_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Simplificaciones actuales (V1, a revisar si hace falta más precisión):
 *   - `followers` (fan_count) es un dato ACTUAL (no histórico): obtener el
 *     número de seguidores de una fecha pasada requiere el permiso "Page
 *     Public Content Access", más sensible. Mientras tanto se aplica el
 *     valor actual a todas las filas del lote de 30 días — el histórico de
 *     seguidores no es exacto día a día, solo la tendencia reciente lo es.
 *   - Los nombres exactos de las métricas de Page Insights (page_impressions,
 *     page_engaged_users) deben revisarse contra la versión vigente de la
 *     Graph API al probar el workflow por primera vez: Meta ha ido
 *     deprecando métricas de Insights de Página en distintas versiones.
 *   - El token de página no se refresca automáticamente: si caduca o el
 *     cliente revoca el acceso, habrá que pedirle que pulse "Reconectar con
 *     Facebook".
 *
 * Nota: Graph API en v25.0 (vigente a jul-2026). Meta da soporte a cada
 * versión ~24 meses desde su publicación — revisar antes de oct-2026.
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
    name: 'Clientes con Facebook',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'facebook' AND external_id IS NOT NULL AND oauth_access_token IS NOT NULL",
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
    name: 'Cliente Facebook',
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
    name: 'Buscar pagina y token',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS page_id, oauth_access_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'facebook'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', page_id: '', oauth_access_token: '' }],
})

const dateRange = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Calcular rango de fechas',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const toIso = (d) => d.toISOString().slice(0, 10);
const end = new Date();
end.setUTCDate(end.getUTCDate() - 1); // ayer (hoy aun no ha cerrado el dia)
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29); // ultimos 30 dias, terminando en "end"
return { json: { ...$json, since: toIso(start), until: toIso(end) } };`,
    },
    position: [1120, 300],
  },
  output: [{ client_id: '', page_id: '', oauth_access_token: '', since: '', until: '' }],
})

const fetchFollowers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Seguidores de la pagina',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $("Buscar pagina y token").item.json.page_id }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'fields', value: 'fan_count' },
          { name: 'access_token', value: expr('{{ $("Buscar pagina y token").item.json.oauth_access_token }}') },
        ],
      },
    },
    position: [1340, 300],
  },
  output: [{ fan_count: 0 }],
})

const fetchInsights = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Insights de la pagina',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $("Buscar pagina y token").item.json.page_id + "/insights" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'metric', value: 'page_impressions,page_engaged_users' },
          { name: 'period', value: 'day' },
          { name: 'since', value: expr('{{ $("Calcular rango de fechas").item.json.since }}') },
          { name: 'until', value: expr('{{ $("Calcular rango de fechas").item.json.until }}') },
          { name: 'access_token', value: expr('{{ $("Buscar pagina y token").item.json.oauth_access_token }}') },
        ],
      },
    },
    position: [1560, 300],
  },
  output: [{ data: [] }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar pagina y token').item.json.client_id;
const pageId = $('Buscar pagina y token').item.json.page_id;
const followers = ($('Seguidores de la pagina').item.json || {}).fan_count || 0;
const resp = $json || {};
const metrics = resp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const byDate = new Map();
for (const m of metrics) {
  for (const v of (m.values || [])) {
    const date = String(v.end_time || '').slice(0, 10);
    if (!date) continue;
    const cur = byDate.get(date) || { impressions: 0, engaged_users: 0 };
    if (m.name === 'page_impressions') cur.impressions = num(v.value);
    if (m.name === 'page_engaged_users') cur.engaged_users = num(v.value);
    byDate.set(date, cur);
  }
}
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'facebook';";
if (byDate.size === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = Array.from(byDate.entries()).map(([date, v]) =>
  '(' + esc(clientId) + '::uuid, ' + esc(pageId) + ', ' + esc(date) + '::date, ' + followers + ', ' + v.impressions + ', ' + v.engaged_users + ')'
).join(',');
const upsertQuery =
  'INSERT INTO facebook_page_daily (client_id, page_id, date, followers, impressions, engaged_users) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date) DO UPDATE SET page_id = EXCLUDED.page_id, followers = EXCLUDED.followers, impressions = EXCLUDED.impressions, engaged_users = EXCLUDED.engaged_users, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: byDate.size } };`,
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

export default workflow('facebook-ingest', 'CRD - Facebook Page to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(dateRange)
  .to(fetchFollowers)
  .to(fetchInsights)
  .to(transform)
  .to(upsert)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
