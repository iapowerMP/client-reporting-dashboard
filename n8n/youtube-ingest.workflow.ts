/**
 * Workflow n8n: "CRD - YouTube to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * Igual que GA4 y Search Console, YouTube solo admite conexión por inicio de
 * sesión (Google): no hay modo API manual. El PM/cliente inicia sesión en
 * Configuración (/api/oauth-google?service=youtube) y elige el canal que
 * administra; el refresh token queda guardado en
 * `data_sources.oauth_refresh_token`.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento
 * (mismo patrón que GA4/Search Console):
 *   1. Schedule (diario, 9:30) → Postgres (clientes con YouTube conectado) →
 *      uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId } en el
 *      body (el canal y el token siempre se resuelven frescos en Supabase).
 *
 * Ambas rutas convergen en "Cliente YouTube" → "Buscar canal y token"
 * (Postgres) → "Refrescar token de Google" (HTTP: Google exige canjear el
 * refresh token por un access token de ~1h antes de cada consulta) →
 * "Estadisticas del canal" (HTTP: youtube/v3/channels, part=statistics) →
 * "Transformar a SQL upsert" → Postgres.
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con YouTube", "Buscar canal y
 *     token", "Upsert en Supabase").
 *
 * En el nodo "Config OAuth Google" hay que rellenar client_id y
 * client_secret: el mismo cliente OAuth de Google Cloud usado por
 * /api/oauth-google (variables de entorno GOOGLE_OAUTH_CLIENT_ID /
 * GOOGLE_OAUTH_CLIENT_SECRET en Vercel), con el scope youtube.readonly
 * añadido. El client_id no es secreto; el client_secret sí — se escribe aquí
 * directamente en la UI de n8n, nunca en este archivo ni en el repo.
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_YOUTUBE_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Simplificación actual (V1): a diferencia de paid media/GA4/GSC, las tres
 * métricas de youtube_daily (subscribers, views, video_count) son SNAPSHOTS
 * del canal en el momento de la sincronización, no cifras del día — la
 * YouTube Data API (channels.list) solo da el acumulado actual, no un
 * desglose diario. Por eso este workflow solo escribe UNA fila por
 * ejecución (la de "hoy"), sin ventana de 30 días como los demás. Para un
 * desglose diario real haría falta la YouTube Analytics API
 * (scope yt-analytics.readonly), más sensible — se deja fuera de este V1.
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 9, triggerAtMinute: 30 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con YouTube',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'youtube' AND external_id IS NOT NULL AND oauth_refresh_token IS NOT NULL",
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
    name: 'Cliente YouTube',
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
    name: 'Buscar canal y token',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS channel_id, oauth_refresh_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'youtube'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', channel_id: '', oauth_refresh_token: '' }],
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
  output: [{ client_id: '', channel_id: '', oauth_refresh_token: '', client_secret: '' }],
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

const fetchChannelStats = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Estadisticas del canal',
    parameters: {
      method: 'GET',
      url: 'https://www.googleapis.com/youtube/v3/channels',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'part', value: 'statistics' },
          { name: 'id', value: expr('{{ $("Buscar canal y token").item.json.channel_id }}') },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.access_token }}') }],
      },
    },
    position: [1560, 300],
  },
  output: [{ items: [] }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar canal y token').item.json.client_id;
const channelId = $('Buscar canal y token').item.json.channel_id;
const resp = $json || {};
const stats = (resp.items && resp.items[0] && resp.items[0].statistics) || {};
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const today = new Date().toISOString().slice(0, 10);
const subscribers = num(stats.subscriberCount);
const views = num(stats.viewCount);
const videoCount = num(stats.videoCount);
const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'youtube';";
const upsertQuery =
  'INSERT INTO youtube_daily (client_id, channel_id, date, subscribers, views, video_count) VALUES (' +
  esc(clientId) + '::uuid, ' + esc(channelId) + ', ' + esc(today) + '::date, ' + subscribers + ', ' + views + ', ' + videoCount +
  ') ON CONFLICT (client_id, date) DO UPDATE SET channel_id = EXCLUDED.channel_id, subscribers = EXCLUDED.subscribers, views = EXCLUDED.views, video_count = EXCLUDED.video_count, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource, rowCount: 1 } };`,
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

export default workflow('youtube-ingest', 'CRD - YouTube to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(oauthConfig)
  .to(refreshToken)
  .to(fetchChannelStats)
  .to(transform)
  .to(upsert)
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
