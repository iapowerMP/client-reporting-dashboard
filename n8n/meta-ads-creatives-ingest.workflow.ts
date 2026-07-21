/**
 * Workflow n8n: "CRD - Meta Ads Creatividades to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * Complementa a "CRD - Meta Ads to Supabase" (que trabaja a nivel de
 * CAMPAÑA): este workflow trae insights a nivel de ANUNCIO — alimenta la
 * tabla "Creatividades" de la pestaña Meta Ads en Paid Media (nombre del
 * anuncio, formato, CTR, Leads/Ventas, CPL/ROAS, frecuencia).
 *
 * Mismo patrón dual-trigger y mismo split API/login por auth_method que
 * "CRD - Meta Ads to Supabase":
 *   1. Schedule (diario, 7:30) → Postgres (clientes con Meta Ads conectado)
 *      → uno por cliente.
 *   2. Webhook (POST) → { clientId } en el body — de momento no está
 *      enlazado a ningún botón "Sincronizar ahora" en Configuración (esa
 *      tabla no es una conexión propia, es parte de Meta Ads); queda listo
 *      por si se quiere disparar manualmente más adelante.
 *
 * Ambas rutas convergen en "Cliente Meta Creatividades" → "Buscar cuenta y
 * credencial (creatividades)" (Postgres, misma cuenta/token que usa Meta Ads
 * a nivel de campaña) → "¿Método de conexión?" (IF, según auth_method):
 *   - 'api'   → "Insights de anuncios (API)" + "Formato de anuncios (API)"
 *     con la credencial compartida "Meta Ads Token" (la misma que usa el
 *     otro workflow de Meta Ads).
 *   - 'oauth' → mismos 2 pasos pero con el token de ESE cliente/PM
 *     (Authorization: Bearer {{ oauth_access_token }} por expresión).
 * Cada rama tiene su propio Code de transformación (porque necesita
 * referenciar sus propios nodos de fetch por nombre) pero ambas confluyen en
 * el mismo Postgres de upsert.
 *
 * Simplificación actual (V1):
 *   - `format` sale de mapear `creative.object_type` (VIDEO→video,
 *     PHOTO/SHARE/LINK→imagen, MULTI_SHARE→carrusel, resto→otro) — es una
 *     aproximación; Meta no expone el tipo de creativo real (DPA, colección)
 *     con un único campo simple. Revisar si se necesita más precisión.
 *   - `conversions`/`conversions_value` usan el mismo conjunto acotado de
 *     action_types que "CRD - Meta Ads to Supabase" (compra, lead, registro
 *     completado...).
 *   - Sin paginación: suficiente para <500 anuncios por cliente.
 *   - El token de oauth no se refresca automáticamente (igual que en el
 *     workflow de campaña): si caduca, tocará "Reconectar con Facebook".
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con Meta Ads (creatividades)",
 *     "Buscar cuenta y credencial (creatividades)", "Upsert en Supabase").
 *   - "Meta Ads Token": la misma credencial de tipo Header Auth que ya
 *     configuraste para "CRD - Meta Ads to Supabase" — no hace falta crear
 *     una nueva. Solo se usa para clientes con auth_method = 'api'.
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): si se activa en el futuro, su URL se guardaría en la variable
 * de entorno de Vercel N8N_META_CREATIVES_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Nota: Graph API en v25.0 (vigente a jul-2026). Meta da soporte a cada
 * versión ~24 meses desde su publicación — revisar antes de oct-2026.
 */
import { workflow, node, trigger, ifElse, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7, triggerAtMinute: 30 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con Meta Ads (creatividades)',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query: "SELECT client_id FROM data_sources WHERE platform = 'meta-ads' AND external_id IS NOT NULL",
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
      path: 'meta-creatives-sync-3f6d2a91c7b845e0a1d9f6c2b7e84a10',
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
    name: 'Cliente Meta Creatividades',
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
    name: 'Buscar cuenta y credencial (creatividades)',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS ad_account_id, auth_method, oauth_access_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'meta-ads'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', ad_account_id: '', auth_method: 'api', oauth_access_token: null }],
})

const checkAuthMethod = ifElse({
  version: 2.3,
  config: {
    name: '¿Método de conexión?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'strict' },
        combinator: 'and',
        conditions: [
          {
            leftValue: expr('{{ $json.auth_method }}'),
            operator: { type: 'string', operation: 'equals' },
            rightValue: 'oauth',
          },
        ],
      },
    },
    position: [1120, 300],
  },
})

const fetchInsightsApi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Insights de anuncios (API)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $json.ad_account_id + "/insights" }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'level', value: 'ad' },
          { name: 'fields', value: 'ad_id,ad_name,campaign_id,impressions,clicks,spend,actions,action_values,frequency' },
          { name: 'time_increment', value: '1' },
          { name: 'date_preset', value: 'last_30d' },
          { name: 'limit', value: '500' },
        ],
      },
    },
    credentials: { httpHeaderAuth: newCredential('Meta Ads Token') },
    position: [1360, 420],
  },
  output: [{ data: [] }],
})

const fetchFormatApi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Formato de anuncios (API)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $("Buscar cuenta y credencial (creatividades)").item.json.ad_account_id + "/ads" }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'fields', value: 'id,creative{object_type}' },
          { name: 'limit', value: '500' },
        ],
      },
    },
    credentials: { httpHeaderAuth: newCredential('Meta Ads Token') },
    position: [1580, 420],
  },
  output: [{ data: [] }],
})

const fetchInsightsOauth = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Insights de anuncios (login)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $json.ad_account_id + "/insights" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'level', value: 'ad' },
          { name: 'fields', value: 'ad_id,ad_name,campaign_id,impressions,clicks,spend,actions,action_values,frequency' },
          { name: 'time_increment', value: '1' },
          { name: 'date_preset', value: 'last_30d' },
          { name: 'limit', value: '500' },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.oauth_access_token }}') }],
      },
    },
    position: [1360, 200],
  },
  output: [{ data: [] }],
})

const fetchFormatOauth = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Formato de anuncios (login)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $("Buscar cuenta y credencial (creatividades)").item.json.ad_account_id + "/ads" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'fields', value: 'id,creative{object_type}' },
          { name: 'limit', value: '500' },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $("Buscar cuenta y credencial (creatividades)").item.json.oauth_access_token }}') }],
      },
    },
    position: [1580, 200],
  },
  output: [{ data: [] }],
})

const transformApi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert (API)',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar cuenta y credencial (creatividades)').item.json.client_id;
const adAccountId = $('Buscar cuenta y credencial (creatividades)').item.json.ad_account_id;
const insights = ($('Insights de anuncios (API)').item.json || {}).data || [];
const formatResp = $json || {};
const formatRows = formatResp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const CONVERSION_TYPES = new Set(['purchase', 'omni_purchase', 'lead', 'omni_lead', 'complete_registration', 'omni_complete_registration', 'submit_application']);
const sumActions = (actions) => Array.isArray(actions) ? actions.filter((a) => CONVERSION_TYPES.has(a.action_type)).reduce((s, a) => s + num(a.value), 0) : 0;
const OBJECT_TYPE_TO_FORMAT = { VIDEO: 'video', PHOTO: 'imagen', SHARE: 'imagen', LINK: 'imagen', MULTI_SHARE: 'carrusel', STATUS: 'otro' };
const formatByAdId = new Map();
for (const a of formatRows) {
  const ot = (a.creative && a.creative.object_type) || '';
  formatByAdId.set(String(a.id), OBJECT_TYPE_TO_FORMAT[ot] || 'otro');
}
const byAdDate = new Map();
for (const r of insights) {
  const key = r.ad_id + '::' + r.date_start;
  const cur = byAdDate.get(key) || {
    ad_id: String(r.ad_id),
    ad_name: r.ad_name || '',
    campaign_id: r.campaign_id ? String(r.campaign_id) : null,
    date: r.date_start,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversions_value: 0,
    frequency: 0,
  };
  cur.impressions += num(r.impressions);
  cur.clicks += num(r.clicks);
  cur.cost += num(r.spend);
  cur.conversions += sumActions(r.actions);
  cur.conversions_value += sumActions(r.action_values);
  cur.frequency = num(r.frequency);
  byAdDate.set(key, cur);
}
const touchDataSource = "UPDATE data_sources SET last_sync = now() WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'meta-ads';";
if (byAdDate.size === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = Array.from(byAdDate.values()).map((x) => {
  const format = formatByAdId.get(x.ad_id) || 'otro';
  return '(' + esc(clientId) + '::uuid, ' + esc(adAccountId) + ', ' + esc(x.date) + '::date, ' + esc(x.ad_id) + ', ' + esc(x.ad_name) + ', ' + (x.campaign_id ? esc(x.campaign_id) : 'NULL') + ', ' + esc(format) + ', ' + x.impressions + ', ' + x.clicks + ', ' + x.cost + ', ' + x.conversions + ', ' + x.conversions_value + ', ' + x.frequency + ')';
}).join(',');
const upsertQuery =
  'INSERT INTO meta_ad_daily (client_id, ad_account_id, date, ad_id, ad_name, campaign_id, format, impressions, clicks, cost, conversions, conversions_value, frequency) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, ad_id) DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id, ad_name = EXCLUDED.ad_name, campaign_id = EXCLUDED.campaign_id, format = EXCLUDED.format, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, cost = EXCLUDED.cost, conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value, frequency = EXCLUDED.frequency, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: byAdDate.size } };`,
    },
    position: [1800, 420],
  },
  output: [{ query: '', rowCount: 0 }],
})

const transformOauth = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert (login)',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar cuenta y credencial (creatividades)').item.json.client_id;
const adAccountId = $('Buscar cuenta y credencial (creatividades)').item.json.ad_account_id;
const insights = ($('Insights de anuncios (login)').item.json || {}).data || [];
const formatResp = $json || {};
const formatRows = formatResp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const CONVERSION_TYPES = new Set(['purchase', 'omni_purchase', 'lead', 'omni_lead', 'complete_registration', 'omni_complete_registration', 'submit_application']);
const sumActions = (actions) => Array.isArray(actions) ? actions.filter((a) => CONVERSION_TYPES.has(a.action_type)).reduce((s, a) => s + num(a.value), 0) : 0;
const OBJECT_TYPE_TO_FORMAT = { VIDEO: 'video', PHOTO: 'imagen', SHARE: 'imagen', LINK: 'imagen', MULTI_SHARE: 'carrusel', STATUS: 'otro' };
const formatByAdId = new Map();
for (const a of formatRows) {
  const ot = (a.creative && a.creative.object_type) || '';
  formatByAdId.set(String(a.id), OBJECT_TYPE_TO_FORMAT[ot] || 'otro');
}
const byAdDate = new Map();
for (const r of insights) {
  const key = r.ad_id + '::' + r.date_start;
  const cur = byAdDate.get(key) || {
    ad_id: String(r.ad_id),
    ad_name: r.ad_name || '',
    campaign_id: r.campaign_id ? String(r.campaign_id) : null,
    date: r.date_start,
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversions_value: 0,
    frequency: 0,
  };
  cur.impressions += num(r.impressions);
  cur.clicks += num(r.clicks);
  cur.cost += num(r.spend);
  cur.conversions += sumActions(r.actions);
  cur.conversions_value += sumActions(r.action_values);
  cur.frequency = num(r.frequency);
  byAdDate.set(key, cur);
}
const touchDataSource = "UPDATE data_sources SET last_sync = now() WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'meta-ads';";
if (byAdDate.size === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = Array.from(byAdDate.values()).map((x) => {
  const format = formatByAdId.get(x.ad_id) || 'otro';
  return '(' + esc(clientId) + '::uuid, ' + esc(adAccountId) + ', ' + esc(x.date) + '::date, ' + esc(x.ad_id) + ', ' + esc(x.ad_name) + ', ' + (x.campaign_id ? esc(x.campaign_id) : 'NULL') + ', ' + esc(format) + ', ' + x.impressions + ', ' + x.clicks + ', ' + x.cost + ', ' + x.conversions + ', ' + x.conversions_value + ', ' + x.frequency + ')';
}).join(',');
const upsertQuery =
  'INSERT INTO meta_ad_daily (client_id, ad_account_id, date, ad_id, ad_name, campaign_id, format, impressions, clicks, cost, conversions, conversions_value, frequency) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, ad_id) DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id, ad_name = EXCLUDED.ad_name, campaign_id = EXCLUDED.campaign_id, format = EXCLUDED.format, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, cost = EXCLUDED.cost, conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value, frequency = EXCLUDED.frequency, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: byAdDate.size } };`,
    },
    position: [1800, 200],
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
    position: [2020, 300],
  },
  output: [{}],
})

export default workflow('meta-ads-creatives-ingest', 'CRD - Meta Ads Creatividades to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(
    checkAuthMethod
      .onTrue(fetchInsightsOauth.to(fetchFormatOauth.to(transformOauth.to(upsert))))
      .onFalse(fetchInsightsApi.to(fetchFormatApi.to(transformApi.to(upsert)))),
  )
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
