/**
 * Workflow n8n: "CRD - Meta Ads to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 * Copia versionada del workflow creado en n8n (SDK @n8n/workflow-sdk).
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento:
 *   1. Schedule (diario, 7:00) → Postgres (lee en Supabase qué clientes tienen
 *      un Ad Account ID de Meta guardado, tabla data_sources) → uno por
 *      cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source cuando el project manager
 *      pulsa "Sincronizar ahora" en Configuración. Recibe { clientId } en el
 *      body (basta con eso: la cuenta y el método de conexión se resuelven
 *      siempre en Supabase, nunca se confía en lo que llegue por webhook).
 *
 * Ambas rutas convergen en "Cliente Meta" (solo aporta client_id) →
 * "Buscar cuenta y credencial" (Postgres: lee de data_sources el Ad Account
 * ID, el método de conexión y, si aplica, el token de oauth — SIEMPRE fresco,
 * así un cambio de cuenta o de método se recoge sin tocar el workflow) →
 * "¿Método de conexión?" (IF, según auth_method):
 *   - 'api'   → HTTP con la credencial compartida "Meta Ads Token" (System
 *     User de nuestro Business Manager; solo ve cuentas compartidas con él).
 *   - 'oauth' → HTTP con el token de ESE cliente/PM (Authorization: Bearer
 *     {{ oauth_access_token }} por expresión, no por credencial de n8n,
 *     porque cada fila puede tener un token distinto). Viene de que el propio
 *     PM/cliente inició sesión con su Facebook en Configuración → conecta
 *     cualquier cuenta que administre, sin depender de nuestro Business
 *     Manager ni de sus límites de partners.
 * Ambas ramas confluyen en el mismo Code (transforma la respuesta a un
 * UPSERT SQL + un UPDATE de data_sources.last_sync) → Postgres (ejecuta
 * ambas sentencias contra Supabase).
 *
 * Al ser dinámico, NO hace falta tocar este workflow al añadir un cliente
 * nuevo ni al cambiar su método de conexión: todo se resuelve en cada
 * ejecución a partir de `data_sources` (endpoints /api/data-sources y
 * /api/oauth-meta-*).
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con Meta Ads", "Buscar cuenta y
 *     credencial" y "Upsert en Supabase").
 *   - "Meta Ads Token": credencial de tipo Header Auth (Name: Authorization,
 *     Value: "Bearer <token de larga duración del System User>", permiso
 *     ads_read). Solo se usa para clientes con auth_method = 'api'. El token
 *     vive solo en esta credencial, nunca en el código del workflow ni en el
 *     repo.
 *
 * El Ad Account ID de Meta se normaliza a "act_XXXXXXXXXX" al guardarlo
 * (/api/data-sources o /api/oauth-meta-finalize), y así se usa directamente
 * en la URL de la API.
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa (con el token real) se guarda solo en la
 * variable de entorno de Vercel N8N_META_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Cada fila de meta_campaign_daily se etiqueta con la cuenta (ad_account_id)
 * que la originó. Si un cliente cambia de cuenta de Meta Ads (o de método de
 * conexión), /api/paid filtra siempre por la cuenta actualmente guardada en
 * data_sources, así que los datos de la cuenta anterior dejan de mostrarse
 * sin necesidad de borrarlos.
 *
 * Simplificaciones actuales (a revisar si hace falta más precisión):
 *   - `status` se marca siempre como 'Activa': el endpoint de insights no
 *     devuelve el estado de la campaña (activa/pausada), solo métricas.
 *   - `conversions`/`conversions_value` se calculan sumando un conjunto
 *     acotado de action_types típicos de conversión (compra, lead, registro
 *     completado...). Puede afinarse por cliente según su evento de
 *     conversión real.
 *   - Sin paginación: suficiente para <500 filas (campañas × 30 días) por
 *     cliente; se añadirá si hace falta.
 *   - El token de oauth (~60 días de vida) no se refresca automáticamente
 *     todavía: si caduca o el cliente revoca el acceso, esa cuenta empezará a
 *     fallar y habrá que pedirle que pulse "Reconectar con Facebook".
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
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con Meta Ads',
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
    name: 'Cliente Meta',
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

const fetchMetaApi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Meta Ads insights (API)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $json.ad_account_id + "/insights" }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'level', value: 'campaign' },
          { name: 'fields', value: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values' },
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

const fetchMetaOauth = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Meta Ads insights (login)',
    parameters: {
      method: 'GET',
      url: expr('{{ "https://graph.facebook.com/v25.0/" + $json.ad_account_id + "/insights" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'level', value: 'campaign' },
          { name: 'fields', value: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values' },
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

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar cuenta y credencial').item.json.client_id;
const adAccountId = $('Buscar cuenta y credencial').item.json.ad_account_id;
const resp = $json || {};
const results = resp.data || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const CONVERSION_TYPES = new Set(['purchase', 'omni_purchase', 'lead', 'omni_lead', 'complete_registration', 'omni_complete_registration', 'submit_application']);
const sumActions = (actions) => Array.isArray(actions) ? actions.filter((a) => CONVERSION_TYPES.has(a.action_type)).reduce((s, a) => s + num(a.value), 0) : 0;
const rows = results.map((r) => ({
  client_id: clientId,
  ad_account_id: adAccountId,
  date: r.date_start,
  campaign_id: String(r.campaign_id),
  campaign_name: r.campaign_name || '',
  status: 'Activa',
  cost: num(r.spend),
  impressions: num(r.impressions),
  clicks: num(r.clicks),
  conversions: sumActions(r.actions),
  conversions_value: sumActions(r.action_values),
}));
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'meta-ads';";
if (rows.length === 0) {
  return { json: { query: touchDataSource, rowCount: 0 } };
}
const values = rows.map((x) =>
  '(' + esc(x.client_id) + '::uuid, ' + esc(x.date) + '::date, ' + esc(x.campaign_id) + ', ' +
  esc(x.campaign_name) + ', ' + esc(x.status) + ', ' + x.cost + ', ' + x.impressions + ', ' +
  x.clicks + ', ' + x.conversions + ', ' + x.conversions_value + ', ' + esc(x.ad_account_id) + ')'
).join(',');
const upsertQuery =
  'INSERT INTO meta_campaign_daily (client_id, date, campaign_id, campaign_name, status, cost, impressions, clicks, conversions, conversions_value, ad_account_id) VALUES ' +
  values +
  ' ON CONFLICT (client_id, date, campaign_id) DO UPDATE SET campaign_name = EXCLUDED.campaign_name, status = EXCLUDED.status, cost = EXCLUDED.cost, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value, ad_account_id = EXCLUDED.ad_account_id, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: rows.length } };`,
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
    position: [1820, 300],
  },
  output: [{}],
})

export default workflow('meta-ads-ingest', 'CRD - Meta Ads to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(
    checkAuthMethod
      .onTrue(fetchMetaOauth.to(transform.to(upsert)))
      .onFalse(fetchMetaApi.to(transform)),
  )
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
