/**
 * Workflow n8n: "CRD - Search Console to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 * Copia versionada del workflow creado en n8n (SDK @n8n/workflow-sdk).
 *
 * Igual que GA4, Search Console solo admite conexión por inicio de sesión
 * (Google): no hay modo API manual. El PM/cliente inicia sesión en
 * Configuración (/api/oauth-google?service=gsc) y elige la propiedad
 * verificada que administra; el refresh token queda guardado en
 * `data_sources.oauth_refresh_token`, propio de cada cliente.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento
 * (mismo patrón que Google Ads/Meta Ads/GA4):
 *   1. Schedule (diario, 9:00) → Postgres (clientes con Search Console
 *      conectado) → uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId } en el
 *      body (la propiedad y el token siempre se resuelven frescos en
 *      Supabase).
 *
 * Ambas rutas convergen en "Cliente GSC" → "Buscar sitio y token" (Postgres)
 * → "Refrescar token de Google" (HTTP: Google exige canjear el refresh token
 * por un access token de ~1h antes de cada consulta) → "Calcular rango de
 * fechas" (Code: últimos 30 días, terminando ayer — Search Console tarda
 * ~2-3 días en consolidar los datos más recientes) → dos consultas
 * secuenciales a la Search Analytics API (por query y por página, porque la
 * API solo admite una combinación de dimensiones por llamada) → sus propios
 * Code + Postgres de upsert.
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con Search Console", "Buscar
 *     sitio y token", "Upsert queries en Supabase", "Upsert páginas en
 *     Supabase").
 *
 * En el nodo "Config OAuth Google" hay que rellenar client_id y
 * client_secret: el mismo cliente OAuth de Google Cloud usado por
 * /api/oauth-google (variables de entorno GOOGLE_OAUTH_CLIENT_ID /
 * GOOGLE_OAUTH_CLIENT_SECRET en Vercel). El client_id no es secreto; el
 * client_secret sí — se escribe aquí directamente en la UI de n8n, nunca en
 * este archivo ni en el repo.
 *
 * Cada fila se etiqueta con el sitio (site_url) que la originó. Si un
 * cliente cambia de propiedad, /api/seo filtra siempre por la propiedad
 * actualmente guardada en data_sources.
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 9 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con Search Console',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'gsc' AND external_id IS NOT NULL AND oauth_refresh_token IS NOT NULL",
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
    position: [240, 700],
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
    position: [460, 700],
  },
  output: [{ client_id: '' }],
})

const mergePoint = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Cliente GSC',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [] },
      includeOtherFields: true,
    },
    position: [680, 480],
  },
  output: [{ client_id: '' }],
})

const lookupAccount = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Buscar sitio y token',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS site_url, oauth_refresh_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'gsc'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', site_url: '', oauth_refresh_token: '' }],
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
  output: [{ client_id: '', site_url: '', oauth_refresh_token: '', client_secret: '' }],
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
end.setUTCDate(end.getUTCDate() - 2); // Search Console tarda ~2-3 días en consolidar los datos más recientes
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29); // últimos 30 días, terminando en "end"
return { json: { ...$json, startDate: toIso(start), endDate: toIso(end) } };`,
    },
    position: [1560, 300],
  },
  output: [{ access_token: '', startDate: '', endDate: '' }],
})

const fetchQueries = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Consultar Search Analytics (query)',
    parameters: {
      method: 'POST',
      url: expr('{{ "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent($("Buscar sitio y token").item.json.site_url) + "/searchAnalytics/query" }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.access_token }}') }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ startDate: $json.startDate, endDate: $json.endDate, dimensions: ["date", "query"], rowLimit: 25000 }) }}',
      ),
    },
    position: [1780, 200],
  },
  output: [{ rows: [] }],
})

const transformQueries = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar queries a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar sitio y token').item.json.client_id;
const siteUrl = $('Buscar sitio y token').item.json.site_url;
const resp = $json || {};
const results = resp.rows || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const rows = results.map((r) => ({
  client_id: clientId,
  site_url: siteUrl,
  date: r.keys[0],
  query: r.keys[1],
  clicks: num(r.clicks),
  impressions: num(r.impressions),
  ctr: num(r.ctr),
  position: num(r.position),
}));
if (rows.length === 0) {
  return { json: { query: null, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.site_url) + ', ' + esc(x.date) + '::date, ' + esc(x.query) + ', ' +
  x.clicks + ', ' + x.impressions + ', ' + x.ctr + ', ' + x.position + ')'
).join(',');
const upsertQuery =
  'INSERT INTO gsc_query_daily (client_id, site_url, date, query, clicks, impressions, ctr, position) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, query) DO UPDATE SET site_url = EXCLUDED.site_url, clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position, updated_at = now();';
return { json: { query: upsertQuery, rowCount: rows.length } };`,
    },
    position: [2000, 200],
  },
  output: [{ query: '', rowCount: 0 }],
})

const upsertQueries = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert queries en Supabase',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query: expr("{{ $json.query || \"SELECT 1;\" }}"),
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [2220, 200],
  },
  output: [{}],
})

const fetchPages = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Consultar Search Analytics (pagina)',
    parameters: {
      method: 'POST',
      url: expr('{{ "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent($("Buscar sitio y token").item.json.site_url) + "/searchAnalytics/query" }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $("Refrescar token de Google").item.json.access_token }}') }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ startDate: $("Calcular rango de fechas").item.json.startDate, endDate: $("Calcular rango de fechas").item.json.endDate, dimensions: ["date", "page"], rowLimit: 25000 }) }}',
      ),
    },
    position: [2440, 300],
  },
  output: [{ rows: [] }],
})

const transformPages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar paginas a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar sitio y token').item.json.client_id;
const siteUrl = $('Buscar sitio y token').item.json.site_url;
const resp = $json || {};
const results = resp.rows || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const rows = results.map((r) => ({
  client_id: clientId,
  site_url: siteUrl,
  date: r.keys[0],
  page: r.keys[1],
  clicks: num(r.clicks),
  impressions: num(r.impressions),
  ctr: num(r.ctr),
  position: num(r.position),
}));
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'gsc';";
if (rows.length === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.site_url) + ', ' + esc(x.date) + '::date, ' + esc(x.page) + ', ' +
  x.clicks + ', ' + x.impressions + ', ' + x.ctr + ', ' + x.position + ')'
).join(',');
const upsertQuery =
  'INSERT INTO gsc_page_daily (client_id, site_url, date, page, clicks, impressions, ctr, position) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, page) DO UPDATE SET site_url = EXCLUDED.site_url, clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: rows.length } };`,
    },
    position: [2660, 300],
  },
  output: [{ query: '', rowCount: 0 }],
})

const upsertPages = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert paginas en Supabase',
    parameters: { resource: 'database', operation: 'executeQuery', query: expr('{{ $json.query }}') },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [2880, 300],
  },
  output: [{}],
})

export default workflow('gsc-ingest', 'CRD - Search Console to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(oauthConfig)
  .to(refreshToken)
  .to(dateRange)
  .to(fetchQueries)
  .to(transformQueries)
  .to(upsertQueries)
  .to(fetchPages)
  .to(transformPages)
  .to(upsertPages)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
