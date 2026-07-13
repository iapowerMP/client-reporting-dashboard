/**
 * Workflow n8n: "Google Ads → Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * Copia versionada del workflow creado en n8n (SDK @n8n/workflow-sdk).
 * Instancia: https://n8n.themediapower.com/workflow/7uXY0RHlPfKkYJXr
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento:
 *   1. Schedule (diario, 6:00) → Postgres (lee en Supabase qué clientes tienen
 *      un Customer ID de Google Ads guardado, tabla data_sources) → uno por
 *      cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source cuando el project manager
 *      pulsa "Sincronizar" en Configuración, para forzar la sincronización
 *      inmediata de un cliente concreto (por ejemplo, justo después de
 *      cambiar su Customer ID). Recibe { clientId, customerId } en el body.
 *
 * A partir de ahí, ambas rutas comparten: Config compartida (developerToken/
 * loginCustomerId/apiVersion, iguales para todos porque se accede vía una
 * cuenta MCC) → HTTP a Google Ads (GAQL, últimos 30 días) → Code (transforma
 * la respuesta a un UPSERT SQL + un UPDATE de data_sources.last_sync) →
 * Postgres (ejecuta ambas sentencias contra Supabase).
 *
 * Al ser dinámico, NO hace falta tocar este workflow cuando se añade un
 * cliente nuevo: basta con que el project manager guarde el Customer ID de su
 * cliente en Configuración → Google Ads (endpoint /api/data-sources), que lo
 * escribe en la tabla `data_sources`. En la siguiente ejecución programada, el
 * workflow lo recoge solo (o al momento, si pulsa "Sincronizar").
 *
 * Credenciales a configurar en n8n (compartidas para todos los clientes):
 *   - Google Ads OAuth2 (nodo "Google Ads search"), vía una cuenta MCC.
 *   - Postgres → Supabase (nodos "Clientes con Google Ads" y "Upsert en Supabase").
 *
 * En el nodo "Config compartida" hay que rellenar: loginCustomerId (MCC id sin
 * guiones), developerToken y apiVersion.
 *
 * El Customer ID de Google Ads se normaliza a solo dígitos tanto al guardarlo
 * (/api/data-sources) como al construir la URL de la API (defensa doble, por
 * si ya hubiera algún valor antiguo guardado con guiones).
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa (con el token real) se guarda solo en la
 * variable de entorno de Vercel N8N_GADS_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Cada fila de gads_campaign_daily se etiqueta con la cuenta (customer_id)
 * que la originó. Si un cliente cambia de cuenta de Google Ads, /api/paid
 * filtra siempre por la cuenta actualmente guardada en data_sources, así que
 * los datos de la cuenta anterior dejan de mostrarse sin necesidad de
 * borrarlos (basta con volver a sincronizar para que las filas nuevas queden
 * etiquetadas con la cuenta correcta).
 *
 * Nota: apiVersion está en "v24" (vigente a jul-2026; Google descontinuó v17-v19).
 * Revisar periódicamente en developers.google.com/google-ads/api/docs/release-notes.
 * La paginación no está implementada (suficiente para <10k filas / 30 días por
 * cliente); se añadirá si hace falta.
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 6 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con Google Ads',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS customer_id FROM data_sources WHERE platform = 'google-ads' AND external_id IS NOT NULL",
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [460, 300],
  },
  output: [{ client_id: '', customer_id: '' }],
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
  output: [{ body: { clientId: '', customerId: '' } }],
})

const normalizeWebhookPayload = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalizar payload webhook',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'w1', name: 'client_id', value: expr('{{ $json.body.clientId }}'), type: 'string' },
          { id: 'w2', name: 'customer_id', value: expr('{{ $json.body.customerId }}'), type: 'string' },
        ],
      },
      includeOtherFields: false,
    },
    position: [460, 560],
  },
  output: [{ client_id: '', customer_id: '' }],
})

const sharedConfig = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config compartida',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'a1', name: 'loginCustomerId', value: 'REEMPLAZAR-mcc-id-sin-guiones', type: 'string' },
          { id: 'a2', name: 'developerToken', value: 'REEMPLAZAR-developer-token', type: 'string' },
          { id: 'a3', name: 'apiVersion', value: 'v24', type: 'string' },
        ],
      },
      includeOtherFields: true,
    },
    position: [680, 420],
  },
  output: [{ client_id: '', customer_id: '', loginCustomerId: '', developerToken: '', apiVersion: '' }],
})

const fetchGads = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Google Ads search',
    parameters: {
      method: 'POST',
      url: expr(
        "{{ 'https://googleads.googleapis.com/' + $json.apiVersion + '/customers/' + $json.customer_id.replace(/\\D/g, '') + '/googleAds:search' }}",
      ),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleAdsOAuth2Api',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'developer-token', value: expr('{{ $json.developerToken }}') },
          { name: 'login-customer-id', value: expr('{{ $json.loginCustomerId }}') },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody:
        '{\n  "query": "SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY segments.date"\n}',
    },
    credentials: { googleAdsOAuth2Api: newCredential('Google Ads') },
    position: [900, 300],
  },
  output: [{ results: [] }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Config compartida').item.json.client_id;
const customerId = $('Config compartida').item.json.customer_id;
const resp = $json || {};
const results = resp.results || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const rows = results.map((r) => {
  const c = r.campaign || {};
  const s = r.segments || {};
  const m = r.metrics || {};
  return {
    client_id: clientId,
    customer_id: customerId,
    date: s.date,
    campaign_id: String(c.id),
    campaign_name: c.name || '',
    status: c.status === 'ENABLED' ? 'Activa' : 'Pausada',
    cost: num(m.costMicros) / 1e6,
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    conversions: num(m.conversions),
    conversions_value: num(m.conversionsValue),
  };
});
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'google-ads';";
if (rows.length === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.date) + '::date, ' + esc(x.campaign_id) + ', ' +
  esc(x.campaign_name) + ', ' + esc(x.status) + ', ' + x.cost + ', ' + x.impressions + ', ' +
  x.clicks + ', ' + x.conversions + ', ' + x.conversions_value + ', ' + esc(x.customer_id) + ')'
).join(',');
const upsertQuery =
  'INSERT INTO gads_campaign_daily (client_id, date, campaign_id, campaign_name, status, cost, impressions, clicks, conversions, conversions_value, customer_id) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, status = EXCLUDED.status, cost = EXCLUDED.cost, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value, customer_id = EXCLUDED.customer_id, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: rows.length } };`,
    },
    position: [1120, 300],
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
    position: [1340, 300],
  },
  output: [{}],
})

export default workflow('gads-ingest', 'Google Ads to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(sharedConfig)
  .to(fetchGads)
  .to(transform)
  .to(upsert)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(sharedConfig)
