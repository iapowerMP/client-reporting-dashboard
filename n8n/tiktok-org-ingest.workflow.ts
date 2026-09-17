/**
 * Workflow n8n: "CRD - TikTok organico to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * TikTok orgánico usa la app de Login Kit (developers.tiktok.com, distinta
 * de la de Ads — ver api/oauth-tiktok.ts): el PM/cliente inicia sesión en
 * Configuración (/api/oauth-tiktok?service=organic) con su propia cuenta de
 * TikTok. A diferencia de la app de Ads, aquí el access_token SÍ caduca
 * (~24h) y hay refresh_token de verdad — y TikTok ROTA el refresh_token en
 * cada canje (devuelve uno nuevo cada vez), así que este workflow tiene que
 * guardar de vuelta en data_sources tanto el access_token como el
 * refresh_token nuevos en cada ejecución, o la siguiente sincronización
 * fallaría con el refresh_token ya usado.
 *
 * Dos formas de disparar la ingesta, que convergen en el mismo procesamiento
 * (mismo patrón que YouTube, que también refresca token de Google antes de
 * cada consulta):
 *   1. Schedule (diario, 11:00) → Postgres (clientes con TikTok orgánico
 *      conectado) → uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId } en el
 *      body (la cuenta y el token siempre se resuelven frescos en Supabase).
 *
 * Ambas rutas convergen en "Cliente TikTok organico" → "Buscar cuenta y
 * token" (Postgres) → "Config OAuth TikTok Login" (client_key/secret) →
 * "Refrescar token de TikTok" (HTTP) → "Datos de la cuenta" (HTTP:
 * user/info/, follower_count/video_count) → "Videos recientes" (HTTP:
 * video/list/, view_count/like_count de los últimos vídeos) → "Transformar
 * a SQL upsert" → Postgres.
 *
 * Monitorización (sync_logs): igual que el resto — "Transformar a SQL
 * upsert" añade un INSERT INTO sync_logs con status='Completado' y
 * records=1 (este workflow siempre escribe una única fila/snapshot, igual
 * que YouTube). "Refrescar token de TikTok", "Datos de la cuenta", "Videos
 * recientes" y "Upsert en Supabase" tienen onError: continueErrorOutput →
 * "Registrar error en sync_logs" → "Detener y marcar error".
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (nodos "Clientes con TikTok organico", "Buscar
 *     cuenta y token", "Upsert en Supabase" y "Registrar error en
 *     sync_logs").
 *
 * En el nodo "Config OAuth TikTok Login" hay que rellenar client_key y
 * client_secret: los mismos de la app de Login Kit usada por
 * /api/oauth-tiktok (variables de entorno TIKTOK_LOGIN_CLIENT_KEY /
 * TIKTOK_LOGIN_CLIENT_SECRET en Vercel). El client_key no es secreto; el
 * client_secret sí — se escribe aquí directamente en la UI de n8n, nunca en
 * este archivo ni en el repo.
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_TIKTOK_ORG_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Simplificaciones actuales (V1, a revisar al probar con datos reales —
 * developers.tiktok.com no ha sido accesible para consultar la
 * documentación desde este entorno, así que los nombres exactos de campos
 * están escritos de memoria):
 *   - Igual que YouTube: followers/video_count son SNAPSHOTS del momento de
 *     la sincronización, no cifras del día — la API pública de TikTok no da
 *     un desglose diario histórico. Por eso este workflow solo escribe UNA
 *     fila por ejecución (la de "hoy").
 *   - video_views/likes son la SUMA de los vídeos que devuelve video/list/
 *     en ese momento (los más recientes, hasta max_count), no el acumulado
 *     histórico completo de la cuenta — aproximación honesta al "reciente",
 *     igual que el aviso ya existente sobre facebook_posts en api/social.ts.
 *   - Sin paginación en video/list/: max_count=20 cubre la actividad
 *     reciente típica; revisar si hace falta más para cuentas muy activas.
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 11 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con TikTok organico',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id FROM data_sources WHERE platform = 'tiktok-org' AND external_id IS NOT NULL AND oauth_refresh_token IS NOT NULL",
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
    name: 'Cliente TikTok organico',
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
    name: 'Buscar cuenta y token',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        "SELECT client_id, external_id AS open_id, oauth_refresh_token FROM data_sources WHERE client_id = $1::uuid AND platform = 'tiktok-org'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', open_id: '', oauth_refresh_token: '' }],
})

const oauthConfig = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config OAuth TikTok Login',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 't1', name: 'client_key', value: 'REEMPLAZAR-tiktok-login-client-key', type: 'string' },
          { id: 't2', name: 'client_secret', value: 'REEMPLAZAR-tiktok-login-client-secret', type: 'string' },
        ],
      },
      includeOtherFields: true,
    },
    position: [1120, 300],
  },
  output: [{ client_id: '', open_id: '', oauth_refresh_token: '', client_key: '', client_secret: '' }],
})

const refreshToken = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Refrescar token de TikTok',
    parameters: {
      method: 'POST',
      url: 'https://open.tiktokapis.com/v2/oauth/token/',
      sendBody: true,
      contentType: 'form-urlencoded',
      specifyBody: 'keypair',
      bodyParameters: {
        parameters: [
          { name: 'client_key', value: expr('{{ $json.client_key }}') },
          { name: 'client_secret', value: expr('{{ $json.client_secret }}') },
          { name: 'grant_type', value: 'refresh_token' },
          { name: 'refresh_token', value: expr('{{ $json.oauth_refresh_token }}') },
        ],
      },
    },
    onError: 'continueErrorOutput',
    position: [1340, 300],
  },
  output: [{ access_token: '', refresh_token: '', expires_in: 86400 }],
})

const fetchUserInfo = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Datos de la cuenta',
    parameters: {
      method: 'GET',
      url: 'https://open.tiktokapis.com/v2/user/info/',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'fields', value: 'open_id,follower_count,video_count' }] },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.access_token }}') }],
      },
    },
    onError: 'continueErrorOutput',
    position: [1560, 220],
  },
  output: [{ data: { user: { open_id: '', follower_count: 0, video_count: 0 } } }],
})

const fetchVideoList = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Videos recientes',
    parameters: {
      method: 'POST',
      url: 'https://open.tiktokapis.com/v2/video/list/',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'fields', value: 'id,view_count,like_count,comment_count,share_count' }] },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('{{ "Bearer " + $("Refrescar token de TikTok").item.json.access_token }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '{ "max_count": 20 }',
    },
    onError: 'continueErrorOutput',
    position: [1560, 380],
  },
  output: [{ data: { videos: [], cursor: 0, has_more: false } }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Buscar cuenta y token').item.json.client_id;
const openId = $('Buscar cuenta y token').item.json.open_id;
const newAccessToken = $('Refrescar token de TikTok').item.json.access_token;
const newRefreshToken = $('Refrescar token de TikTok').item.json.refresh_token;
const userResp = $('Datos de la cuenta').item.json || {};
const user = (userResp.data && userResp.data.user) || {};
const videoResp = $json || {};
const videos = (videoResp.data && videoResp.data.videos) || [];
const esc = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const today = new Date().toISOString().slice(0, 10);
const followers = num(user.follower_count);
const videoCount = num(user.video_count);
const videoViews = videos.reduce((s, v) => s + num(v.view_count), 0);
const likes = videos.reduce((s, v) => s + num(v.like_count), 0);
// Guarda el access_token/refresh_token NUEVOS (TikTok rota el refresh_token
// en cada canje) — si no se persisten aqui, la siguiente sincronizacion
// fallaria con el refresh_token ya usado.
const touchDataSource =
  "UPDATE data_sources SET last_sync = now(), status = 'conectado', oauth_access_token = " + esc(newAccessToken) +
  ", oauth_refresh_token = " + esc(newRefreshToken) +
  " WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'tiktok-org';";
const syncLogInsert = "INSERT INTO sync_logs (client_id, platform, status, records) VALUES (" + esc(clientId) + "::uuid, 'tiktok-org', 'Completado', 1);";
const upsertQuery =
  'INSERT INTO tiktok_daily (client_id, open_id, date, followers, video_count, video_views, likes) VALUES (' +
  esc(clientId) + '::uuid, ' + esc(openId) + ', ' + esc(today) + '::date, ' + followers + ', ' + videoCount + ', ' + videoViews + ', ' + likes +
  ') ON CONFLICT (client_id, date) DO UPDATE SET open_id = EXCLUDED.open_id, followers = EXCLUDED.followers, video_count = EXCLUDED.video_count, video_views = EXCLUDED.video_views, likes = EXCLUDED.likes, updated_at = now();';
return { json: { query: upsertQuery + ' ' + touchDataSource + ' ' + syncLogInsert, rowCount: 1 } };`,
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
    onError: 'continueErrorOutput',
    position: [2000, 300],
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
        "INSERT INTO sync_logs (client_id, platform, status, records, error_message) VALUES ('{{ $(\"Cliente TikTok organico\").item.json.client_id }}'::uuid, 'tiktok-org', 'Error', 0, '{{ ($json.error?.message ?? \"Error desconocido\").replace(/'/g, \"''\") }}');",
      ),
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [1780, 560],
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
      errorMessage: expr('{{ $json.error?.message ?? "Error desconocido en la sincronizacion de TikTok organico" }}'),
    },
    position: [2000, 560],
  },
  output: [{}],
})

export default workflow('tiktok-org-ingest', 'CRD - TikTok organico to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(oauthConfig)
  .to(refreshToken.onError(logSyncError))
  .to(fetchUserInfo.onError(logSyncError))
  .to(fetchVideoList.onError(logSyncError))
  .to(transform)
  .to(upsert.onError(logSyncError))
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
  .add(logSyncError)
  .to(stopOnError)
