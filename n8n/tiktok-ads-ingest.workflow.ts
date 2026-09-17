/**
 * Workflow n8n: "CRD - TikTok Ads to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * TikTok Ads solo admite conexión por inicio de sesión (la app de Marketing
 * API/Business API, ver api/oauth-tiktok.ts): el PM/cliente inicia sesión en
 * Configuración (/api/oauth-tiktok?service=ads) y elige el Advertiser ID que
 * administra. A diferencia de Meta/Google, el access_token de esta app NO
 * caduca por sí solo (no hay refresh_token) — así que no hace falta un paso
 * de refresco de token aquí, ni una rama de conexión "por API" con
 * credencial compartida.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento
 * (mismo patrón que el resto de plataformas):
 *   1. Schedule (diario, 10:00) → Postgres (clientes con TikTok Ads
 *      conectado) → uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId } en el
 *      body (la cuenta y el token siempre se resuelven frescos en Supabase).
 *
 * Ambas rutas convergen en "Cliente TikTok Ads" → "Buscar cuenta y
 * credencial" (Postgres) → "Elegir ventana de fechas" → "Informe de TikTok
 * Ads" (HTTP: report/integrated/get/, nivel de campaña, granularidad día) →
 * "Transformar a SQL upsert" → Postgres.
 *
 * Monitorización (sync_logs): igual que el resto — "Transformar a SQL
 * upsert" añade un INSERT INTO sync_logs con status='Completado'; "Informe
 * de TikTok Ads" y "Upsert en Supabase" tienen onError: continueErrorOutput
 * → "Registrar error en sync_logs" → "Detener y marcar error".
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con TikTok Ads", "Buscar cuenta y
 *     credencial", "Upsert en Supabase" y "Registrar error en sync_logs").
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_TIKTOK_ADS_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Simplificaciones actuales (V1, a revisar al probar con datos reales —
 * business-api.tiktok.com no ha sido accesible para consultar la
 * documentación desde este entorno, así que los nombres exactos de campos
 * están escritos de memoria):
 *   - `status` se marca siempre como 'Activa' (igual que Meta Ads): el
 *     endpoint de reporting no devuelve el estado operativo de la campaña,
 *     solo métricas — para eso haría falta una llamada aparte a
 *     campaign/get/.
 *   - `conversions_value` se deja siempre en 0: con las métricas básicas
 *     usadas aquí (spend/impressions/clicks/conversion/cost_per_conversion)
 *     no hay un campo de valor monetario de conversión fiable confirmado —
 *     hay que revisar con una cuenta real qué métrica de TikTok (algo tipo
 *     "total_onsite_shopping_value" o similar, según el objetivo de
 *     campaña) da el valor, para poder calcular ROAS como en Meta/Google.
 *   - Ventana de fechas: fija a los últimos 30 días en cada sincronización
 *     (a diferencia de Meta/Google Ads, no se ha confirmado un equivalente
 *     de "traer todo el histórico" para la primera sincronización de un
 *     cliente nuevo — añadir si se confirma que la API lo admite).
 *   - Sin paginación: suficiente para <1000 filas (campañas × días) por
 *     cliente en 30 días; revisar `page_info`/`page` de la respuesta si una
 *     cuenta con muchas campañas se queda corta.
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 10 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con TikTok Ads',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'tiktok-ads' AND external_id IS NOT NULL AND oauth_access_token IS NOT NULL",
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
    name: 'Cliente TikTok Ads',
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
    name: 'Buscar cuenta y credencial',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS advertiser_id, oauth_access_token, last_sync FROM data_sources WHERE client_id = $1::uuid AND platform = 'tiktok-ads'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', advertiser_id: '', oauth_access_token: '', last_sync: null }],
})

const chooseDateWindow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Elegir ventana de fechas',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const toIso = (d) => d.toISOString().slice(0, 10);
const end = new Date();
end.setUTCDate(end.getUTCDate() - 1); // ayer (hoy aun no ha cerrado el dia)
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29); // ultimos 30 dias, terminando en "end"
return { json: { ...$json, startDate: toIso(start), endDate: toIso(end) } };`,
    },
    position: [1120, 300],
  },
  output: [
    { client_id: '', advertiser_id: '', oauth_access_token: '', last_sync: null, startDate: '', endDate: '' },
  ],
})

const fetchReport = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Informe de TikTok Ads',
    parameters: {
      method: 'GET',
      url: 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'advertiser_id', value: expr('{{ $json.advertiser_id }}') },
          { name: 'report_type', value: 'BASIC' },
          { name: 'data_level', value: 'AUCTION_CAMPAIGN' },
          { name: 'dimensions', value: '["campaign_id","stat_time_day"]' },
          { name: 'metrics', value: '["campaign_name","spend","impressions","clicks","conversion","cost_per_conversion"]' },
          { name: 'start_date', value: expr('{{ $json.startDate }}') },
          { name: 'end_date', value: expr('{{ $json.endDate }}') },
          { name: 'page_size', value: '1000' },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Access-Token', value: expr('{{ $json.oauth_access_token }}') }],
      },
      // Igual que en Meta Ads: si una cuenta rota (token revocado, permiso
      // retirado) devolviera un error HTTP en vez de code!=0 dentro de un
      // 200, esto evita que ese único cliente tire el resto del lote de la
      // ejecución diaria.
      options: { response: { response: { neverError: true } } },
    },
    onError: 'continueErrorOutput',
    position: [1360, 300],
  },
  output: [{ code: 0, message: 'OK', data: { list: [] } }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar cuenta y credencial').item.json.client_id;
const advertiserId = $('Buscar cuenta y credencial').item.json.advertiser_id;
const resp = $json || {};
const results = (resp.data && resp.data.list) || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const rows = results
  .map((r) => {
    const d = r.dimensions || {};
    const m = r.metrics || {};
    return {
      client_id: clientId,
      advertiser_id: advertiserId,
      date: d.stat_time_day ? String(d.stat_time_day).slice(0, 10) : '',
      campaign_id: String(d.campaign_id || ''),
      campaign_name: m.campaign_name || '',
      status: 'Activa',
      cost: num(m.spend),
      impressions: num(m.impressions),
      clicks: num(m.clicks),
      conversions: num(m.conversion),
      // Ver nota en la cabecera del fichero: no confirmado que metrica de
      // TikTok da el valor monetario de conversion todavia.
      conversions_value: 0,
    };
  })
  .filter((r) => r.date && r.campaign_id);
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'tiktok-ads';";
const syncLogInsert = "INSERT INTO sync_logs (client_id, platform, status, records) VALUES (" + esc(clientId) + "::uuid, 'tiktok-ads', 'Completado', " + rows.length + ");";
if (rows.length === 0) {
  return { json: { query: touchDataSource + ' ' + syncLogInsert, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.date) + '::date, ' + esc(x.campaign_id) + ', ' +
  esc(x.campaign_name) + ', ' + esc(x.status) + ', ' + x.cost + ', ' + x.impressions + ', ' +
  x.clicks + ', ' + x.conversions + ', ' + x.conversions_value + ', ' + esc(x.advertiser_id) + ')'
).join(',');
const upsertQuery =
  'INSERT INTO tiktok_campaign_daily (client_id, date, campaign_id, campaign_name, status, cost, impressions, clicks, conversions, conversions_value, advertiser_id) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, status = EXCLUDED.status, cost = EXCLUDED.cost, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value, advertiser_id = EXCLUDED.advertiser_id, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource + ' ' + syncLogInsert, rowCount: rows.length } };`,
    },
    position: [1600, 300],
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
    onError: 'continueErrorOutput',
    position: [1820, 300],
  },
  output: [{}],
})

const logSyncError = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar error en sync_logs',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query: expr(
        "INSERT INTO sync_logs (client_id, platform, status, records, error_message) VALUES ('{{ $(\"Cliente TikTok Ads\").item.json.client_id }}'::uuid, 'tiktok-ads', 'Error', 0, '{{ ($json.error?.message ?? \"Error desconocido\").replace(/'/g, \"''\") }}');",
      ),
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [1600, 560],
  },
  output: [{}],
})

const stopOnError = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Detener y marcar error',
    parameters: {
      errorType: 'errorMessage',
      errorMessage: expr('{{ $json.error?.message ?? "Error desconocido en la sincronizacion de TikTok Ads" }}'),
    },
    position: [1820, 560],
  },
  output: [{}],
})

export default workflow('tiktok-ads-ingest', 'CRD - TikTok Ads to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(chooseDateWindow)
  .to(fetchReport.onError(logSyncError))
  .to(transform)
  .to(upsert.onError(logSyncError))
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
  .add(logSyncError)
  .to(stopOnError)
