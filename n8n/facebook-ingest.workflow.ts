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
 * (Postgres) + "Calcular rango de fechas" (últimos 30 días), y desde ahí se
 * ramifica en dos ingestas independientes (si una falla no bloquea la otra):
 *   A) "Insights de la pagina" (HTTP: page_follows/page_views_total/
 *      page_post_engagements por día) → "Transformar a SQL upsert" →
 *      Postgres — tabla facebook_page_daily.
 *   B) "Publicaciones de la pagina" (HTTP: GET /posts — id/message/
 *      created_time/permalink_url/shares, hasta 100 más recientes) →
 *      "Transformar publicaciones a SQL upsert" → Postgres — tabla
 *      facebook_posts. Esto es lo que permite un conteo real de
 *      "Publicaciones" en el dashboard (antes fijo a 0). likes/comments por
 *      publicación quedan fuera por ahora: ese edge exige la feature "Page
 *      Public Content Access" de Meta (revisión de app aparte, pendiente).
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con Facebook", "Buscar pagina y
 *     token", "Upsert en Supabase").
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_FACEBOOK_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Métricas (confirmadas a mano en el Explorador de la API Graph en
 * sep-2026, tras la deprecación de Meta de nov-2025 que tumbó
 * page_impressions/page_engaged_users/fan_count):
 *   - followers    ← page_follows          (histórico real día a día, ya no
 *                                            hace falta aplicar el valor
 *                                            actual a todo el lote)
 *   - impressions  ← page_views_total      (vistas de la página, no de
 *                                            contenido — Meta fusionó
 *                                            "impressions" dentro de "views")
 *   - engaged_users ← page_post_engagements (like+comentario+compartir del
 *                                            día, total de interacciones —
 *                                            ya no es "usuarios únicos" como
 *                                            la métrica vieja, pero es la
 *                                            aproximación más cercana viva)
 * Las columnas de Supabase conservan sus nombres originales para no romper
 * el resto de la app; lo que cambia es de qué métrica de Meta se rellenan.
 * "Insights de la pagina" mantiene options.response.neverError = true: si
 * Meta vuelve a deprecar alguna de estas tres, el día se guarda con lo que
 * falte a 0 en vez de romper toda la sincronización.
 *   - El token de página no se refresca automáticamente: si caduca o el
 *     cliente revoca el acceso, habrá que pedirle que pulse "Reconectar con
 *     Facebook".
 *
 * Nota: Graph API en v25.0 (vigente a sep-2026). Meta da soporte a cada
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
          { name: 'metric', value: 'page_follows,page_views_total,page_post_engagements' },
          { name: 'period', value: 'day' },
          { name: 'since', value: expr('{{ $("Calcular rango de fechas").item.json.since }}') },
          { name: 'until', value: expr('{{ $("Calcular rango de fechas").item.json.until }}') },
          { name: 'access_token', value: expr('{{ $("Buscar pagina y token").item.json.oauth_access_token }}') },
        ],
      },
      options: { response: { response: { neverError: true } } },
    },
    position: [1340, 300],
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
const untilDate = $('Calcular rango de fechas').item.json.until;
const resp = $json || {};
const metrics = resp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const byDate = new Map();
for (const m of metrics) {
  for (const v of (m.values || [])) {
    const date = String(v.end_time || '').slice(0, 10);
    if (!date) continue;
    const cur = byDate.get(date) || { followers: 0, impressions: 0, engaged_users: 0 };
    if (m.name === 'page_follows') cur.followers = num(v.value);
    if (m.name === 'page_views_total') cur.impressions = num(v.value);
    if (m.name === 'page_post_engagements') cur.engaged_users = num(v.value);
    byDate.set(date, cur);
  }
}
// Si Insights falla (p. ej. Meta vuelve a deprecar alguna métrica) o no trae
// datos, se guarda igualmente una fila vacía del día de hoy: mejor un hueco
// honesto que no guardar nada ni dejar de actualizar last_sync.
if (byDate.size === 0) {
  byDate.set(untilDate, { followers: 0, impressions: 0, engaged_users: 0 });
}
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'facebook';";
const values = Array.from(byDate.entries()).map(([date, v]) =>
  '(' + esc(clientId) + '::uuid, ' + esc(pageId) + ', ' + esc(date) + '::date, ' + v.followers + ', ' + v.impressions + ', ' + v.engaged_users + ')'
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

const fetchPosts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Publicaciones de la pagina',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $("Buscar pagina y token").item.json.page_id + "/posts" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'fields', value: 'id,message,created_time,permalink_url,shares' },
          { name: 'limit', value: '100' },
          { name: 'access_token', value: expr('{{ $("Buscar pagina y token").item.json.oauth_access_token }}') },
        ],
      },
      options: { response: { response: { neverError: true } } },
    },
    position: [1340, 500],
  },
  output: [{ data: [] }],
})

const transformPosts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar publicaciones a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar pagina y token').item.json.client_id;
const pageId = $('Buscar pagina y token').item.json.page_id;
const resp = $json || {};
const posts = resp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null ? 0 : Number(v));
if (posts.length === 0) {
  return { json: { query: 'SELECT 1;', rowCount: 0 } };
}
const values = posts.map((p) => {
  const created = p.created_time ? esc(p.created_time) + '::timestamptz' : 'null';
  const message = p.message ? esc(p.message) : 'null';
  const permalink = p.permalink_url ? esc(p.permalink_url) : 'null';
  const shares = num((p.shares || {}).count);
  return '(' + esc(clientId) + '::uuid, ' + esc(pageId) + ', ' + esc(p.id) + ', ' + created + ', ' + message + ', ' + permalink + ', ' + shares + ')';
}).join(',');
const upsertQuery =
  'INSERT INTO facebook_posts (client_id, page_id, post_id, created_time, message, permalink_url, shares) VALUES ' +
  values +
  ' ON CONFLICT (client_id, post_id) DO UPDATE SET page_id = EXCLUDED.page_id, created_time = EXCLUDED.created_time, message = EXCLUDED.message, permalink_url = EXCLUDED.permalink_url, shares = EXCLUDED.shares, updated_at = now();';
return { json: { query: upsertQuery, rowCount: posts.length } };`,
    },
    position: [1780, 500],
  },
  output: [{ query: '', rowCount: 0 }],
})

const upsertPosts = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert publicaciones en Supabase',
    parameters: { resource: 'database', operation: 'executeQuery', query: expr('{{ $json.query }}') },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [2000, 500],
  },
  output: [{}],
})

export default workflow('facebook-ingest', 'CRD - Facebook Page to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(dateRange)
  .to(fetchInsights)
  .to(transform)
  .to(upsert)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
  .add(dateRange)
  .to(fetchPosts)
  .to(transformPosts)
  .to(upsertPosts)
