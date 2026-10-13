/**
 * Workflow n8n: "CRD - HubSpot to Supabase (ingesta diaria, multi-cliente)"
 * ----------------------------------------------------------------------------
 * ESTADO: creado y activo en n8n (id 6DR41yLT4oudCett,
 * https://n8n.themediapower.com/workflow/6DR41yLT4oudCett). Este archivo es
 * el espejo versionado del workflow real — cualquier cambio aquí debe
 * pasarse también por validate_workflow → update_workflow (MCP de n8n) para
 * que el workflow en vivo quede igual.
 *
 * El prefijo "CRD" (Client Reporting Dashboard) identifica los workflows de
 * este proyecto entre los demás que puedan convivir en la misma instancia
 * de n8n.
 *
 * HubSpot se conecta con un Private App Token (Configuración →
 * /api/data-sources.ts, auth_method='private-app'), pegado a mano por
 * cliente — no hay OAuth ni revisión de app. El token vive en
 * data_sources.oauth_access_token y no caduca por sí solo (a diferencia de
 * TikTok orgánico), así que este workflow no necesita refrescarlo.
 *
 * Dos formas de disparar la ingesta (mismo patrón que el resto):
 *   1. Schedule (diario, 12:00) → Postgres (clientes con HubSpot conectado)
 *      → uno por cliente.
 *   2. Webhook (POST) → lo llama /api/sync-source. Recibe { clientId }.
 *
 * Ambas convergen en "Cliente HubSpot" → "Buscar token y si es primera
 * sincronizacion" (Postgres: token + recuento de hubspot_contacts ya
 * importados) → "Ventana de fechas" (Code: decide si se pide histórico
 * completo o solo los últimos 90 días) → "Obtener pipelines" (HTTP) →
 * "Buscar contactos" (HTTP) → "Buscar deals" (HTTP) → "Cuerpo asociaciones"
 * (Code) → "Asociaciones deal-contacto" (HTTP) → "Transformar a SQL upsert"
 * (Code: arma los dos upserts + touch de data_sources + sync_logs) →
 * Postgres.
 *
 * Endpoints de la API de HubSpot usados (api.hubapi.com, header
 * `Authorization: Bearer <token>`):
 *   - GET  /crm/v3/pipelines/deals
 *   - POST /crm/v3/objects/contacts/search
 *   - POST /crm/v3/objects/deals/search
 *   - POST /crm/v4/associations/deals/contacts/batch/read
 *
 * Propiedades de contacto leídas: email, createdate, lifecyclestage,
 * utm_campaign, utm_source, utm_medium, utm_content, utm_term,
 * hs_analytics_source — nombres de propiedad internos por defecto de
 * HubSpot (confirmados con un ejemplo real del usuario: utm_content llevaba
 * el ad_id de Meta Ads, formato idéntico a meta_ad_daily.ad_id).
 * hs_analytics_source es la "Fuente original de tráfico" que se ve en la
 * ficha del contacto (ORGANIC_SEARCH, PAID_SOCIAL, DIRECT_TRAFFIC,
 * REFERRALS, EMAIL_MARKETING, SOCIAL_MEDIA, PAID_SEARCH, OTHER_CAMPAIGNS,
 * OFFLINE...) — se guarda tal cual en hubspot_contacts.original_source; la
 * traducción a español para mostrarlo vive en el frontend (catalog.ts), no
 * aquí, para no tener que republicar el workflow si se afina el mapeo.
 *
 * Monitorización (sync_logs): igual que el resto — "Transformar a SQL
 * upsert" añade un INSERT INTO sync_logs con status='Completado' y
 * records = nº de contactos + deals procesados. Los nodos HTTP y el upsert
 * final tienen onError: continueErrorOutput → "Registrar error en
 * sync_logs" → "Detener y marcar error".
 *
 * Credenciales a configurar en n8n:
 *   - Postgres → Supabase (todos los nodos Postgres).
 *   - Los nodos HTTP no necesitan credencial de n8n: el token se pasa en la
 *     cabecera Authorization vía expresión, leído de data_sources en cada
 *     ejecución (no hay credencial compartida — cada cliente tiene la suya).
 *
 * El path del webhook debe ser un token largo y aleatorio (actúa como
 * secreto): la URL completa se guarda solo en la variable de entorno de
 * Vercel N8N_HUBSPOT_SYNC_WEBHOOK_URL, nunca en el repo.
 *
 * Simplificaciones actuales (V1, a revisar al probar con datos reales):
 *   - Paginación real (añadida tras detectar el bug): "Buscar contactos" y
 *     "Buscar deals" usan la paginación nativa del nodo HTTP Request
 *     (`paginationMode: updateAParameterInEachRequest`, sobrescribiendo el
 *     campo `after` del body con `paging.next.after` de la respuesta
 *     anterior, hasta que ya no venga `paging.next`). Antes se pedía solo
 *     `limit: 100` y se descartaba el resto — con más de 100 contactos o
 *     deals modificados en la ventana (90 días, o el histórico completo en
 *     la primera sincronización), todo lo que no cupiera en esa primera
 *     página se perdía silenciosamente. Esto se detectó porque un contacto
 *     real de hace una semana (con UTM de pago completo) nunca llegaba a
 *     Supabase: entre su fecha de creación y la sincronización siguiente ya
 *     se habían modificado más de 100 contactos, así que quedaba fuera de
 *     la única página que se pedía. Cada búsqueda pagina hasta un máximo de
 *     10 páginas (1000 filas) por ejecución como límite de seguridad; cada
 *     página paginada se une en un único item en "Unir paginas de
 *     contactos"/"Unir paginas de deals" (Code, runOnceForAllItems) antes
 *     de seguir la cadena, porque el nodo HTTP con paginación emite un item
 *     por página, no uno combinado.
 *     IMPORTANTE: ambas búsquedas siguen llevando `sorts: [{ propertyName:
 *     "createdate", direction: "DESCENDING" }]` — con el límite de 100 por
 *     página esto hacía que cada sincronización trajera al menos lo más
 *     nuevo; ahora con paginación ya no es estrictamente necesario para
 *     evitar perder filas, pero se mantiene porque no hace daño y mantiene
 *     consistente el orden de llegada entre ejecuciones.
 *   - "Asociación principal" de un deal = el primer contacto que devuelve
 *     la API de asociaciones para ese deal (`to[0]`), sin desambiguar si
 *     HubSpot alguna vez devuelve varios.
 *   - Si el mismo deal/contacto se re-sincroniza fuera de la ventana de 90
 *     días (p. ej. se reabre un deal muy antiguo), no se volverá a traer
 *     hasta la próxima primera-sincronización — mismo límite que el resto
 *     de integraciones de este proyecto (no hay cursor incremental
 *     persistido, solo una ventana rodante).
 */
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk'

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Cada dia',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 12 }] } },
    position: [240, 300],
  },
  output: [{}],
})

const getClients = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Clientes con HubSpot',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query: "SELECT client_id FROM data_sources WHERE platform = 'hubspot' AND oauth_access_token IS NOT NULL",
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
      path: 'hubspot-sync-9191cf2437653bb2ee0a7530124762580a519ba0c9aeeb67fb6c0776ef5053f3',
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
    name: 'Cliente HubSpot',
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
    name: 'Buscar token y si es primera sincronizacion',
    parameters: {
      resource: 'database',
      operation: 'executeQuery',
      query:
        'SELECT ds.client_id, ds.oauth_access_token AS token, ' +
        '(SELECT count(*) FROM hubspot_contacts hc WHERE hc.client_id = ds.client_id) AS existing_contacts ' +
        "FROM data_sources ds WHERE ds.client_id = $1::uuid AND ds.platform = 'hubspot'",
      options: { queryReplacement: expr('{{ $json.client_id }}') },
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [900, 300],
  },
  output: [{ client_id: '', token: '', existing_contacts: 0 }],
})

const dateWindow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Ventana de fechas',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $json.client_id;
const token = $json.token;
const isFirstSync = Number($json.existing_contacts) === 0;
// Primera sincronizacion = historico completo (sinceMs=0, epoch);
// siguientes = solo lo modificado en los ultimos 90 dias.
const sinceMs = isFirstSync ? 0 : Date.now() - 90 * 24 * 60 * 60 * 1000;
return { json: { client_id: clientId, token, sinceMs } };`,
    },
    position: [1120, 300],
  },
  output: [{ client_id: '', token: '', sinceMs: 0 }],
})

const fetchPipelines = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Obtener pipelines',
    parameters: {
      method: 'GET',
      url: 'https://api.hubapi.com/crm/v3/pipelines/deals',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('{{ "Bearer " + $json.token }}') }],
      },
    },
    onError: 'continueErrorOutput',
    position: [1340, 180],
  },
  output: [{ results: [{ id: '', label: '', displayOrder: 0, stages: [{ id: '', label: '', displayOrder: 0, metadata: { isClosed: 'false', probability: '0' } }] }] }],
})

const fetchContacts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Buscar contactos',
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v3/objects/contacts/search',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          // No se usa $json aquí: este nodo va después de "Obtener pipelines"
          // en la cadena, así que $json sería la respuesta de pipelines, no
          // la ventana de fechas — se referencia el nodo por nombre.
          { name: 'Authorization', value: expr('{{ "Bearer " + $("Ventana de fechas").item.json.token }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: {
        limit: 100,
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        properties: ['email', 'createdate', 'lifecyclestage', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term', 'hs_analytics_source'],
        filterGroups: [
          {
            filters: [
              { propertyName: 'lastmodifieddate', operator: 'GTE', value: expr('{{ String($("Ventana de fechas").item.json.sinceMs) }}') },
            ],
          },
        ],
      },
      options: {
        pagination: {
          pagination: {
            paginationMode: 'updateAParameterInEachRequest',
            parameters: {
              parameters: [
                { type: 'body', name: 'after', value: expr('{{ $response.body.paging?.next?.after }}') },
              ],
            },
            paginationCompleteWhen: 'other',
            completeExpression: expr('{{ !$response.body.paging?.next?.after }}'),
            limitPagesFetched: true,
            maxRequests: 10,
            requestInterval: 300,
          },
        },
      },
    },
    onError: 'continueErrorOutput',
    position: [1560, 180],
  },
  output: [{ results: [{ id: '', properties: { email: '', createdate: '', lifecyclestage: '', utm_campaign: '', utm_source: '', utm_medium: '', utm_content: '', utm_term: '', hs_analytics_source: '' } }], paging: { next: { after: '' } } }],
})

// El nodo anterior emite un item por cada página pedida (paginación nativa
// del HTTP Request) — se unen en un único item antes de seguir la cadena,
// porque el resto del workflow (y "Transformar a SQL upsert" en particular)
// da por hecho 1 item = 1 cliente.
const flattenContacts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Unir paginas de contactos',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const results = [];
for (const item of $input.all()) {
  results.push(...((item.json && item.json.results) || []));
}
return [{ json: { results } }];`,
    },
    position: [1780, 180],
  },
  output: [{ results: [{ id: '', properties: { email: '' } }] }],
})

const fetchDeals = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Buscar deals',
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v3/objects/deals/search',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('{{ "Bearer " + $("Ventana de fechas").item.json.token }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: {
        limit: 100,
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        properties: ['dealname', 'amount', 'dealstage', 'pipeline', 'createdate', 'closedate', 'hs_is_closed', 'hs_is_closed_won'],
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: expr('{{ String($("Ventana de fechas").item.json.sinceMs) }}') },
            ],
          },
        ],
      },
      options: {
        pagination: {
          pagination: {
            paginationMode: 'updateAParameterInEachRequest',
            parameters: {
              parameters: [
                { type: 'body', name: 'after', value: expr('{{ $response.body.paging?.next?.after }}') },
              ],
            },
            paginationCompleteWhen: 'other',
            completeExpression: expr('{{ !$response.body.paging?.next?.after }}'),
            limitPagesFetched: true,
            maxRequests: 10,
            requestInterval: 300,
          },
        },
      },
    },
    onError: 'continueErrorOutput',
    position: [2000, 180],
  },
  output: [{ results: [{ id: '', properties: { dealname: '', amount: '', dealstage: '', pipeline: '', createdate: '', closedate: '', hs_is_closed: 'false', hs_is_closed_won: 'false' } }], paging: { next: { after: '' } } }],
})

const flattenDeals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Unir paginas de deals',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const results = [];
for (const item of $input.all()) {
  results.push(...((item.json && item.json.results) || []));
}
return [{ json: { results } }];`,
    },
    position: [2220, 180],
  },
  output: [{ results: [{ id: '', properties: { dealname: '' } }] }],
})

const buildAssociationsBody = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Cuerpo asociaciones',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const deals = ($json.results || []);
const inputs = deals.map((d) => ({ id: d.id }));
return { json: { associationsBody: JSON.stringify({ inputs }), hasDeals: inputs.length > 0 } };`,
    },
    position: [2440, 180],
  },
  output: [{ associationsBody: '{"inputs":[]}', hasDeals: false }],
})

const fetchAssociations = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Asociaciones deal-contacto',
    parameters: {
      method: 'POST',
      url: 'https://api.hubapi.com/crm/v4/associations/deals/contacts/batch/read',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('{{ "Bearer " + $("Ventana de fechas").item.json.token }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('{{ $json.associationsBody }}'),
    },
    onError: 'continueErrorOutput',
    position: [2660, 180],
  },
  output: [{ results: [{ from: { id: '' }, to: [{ toObjectId: '' }] }] }],
})

const transform = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Transformar a SQL upsert',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: `const clientId = $('Ventana de fechas').item.json.client_id;
const esc = (v) => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
const escNullable = (v) => (v === undefined || v === null || v === '' ? 'NULL' : esc(v));
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

// --- Mapa de etapas (id -> {label, order, isClosed, isWon}) ---
const pipelinesResp = $('Obtener pipelines').item.json || {};
const pipelines = pipelinesResp.results || [];
// is_closed/is_won del deal se toman de sus propias propiedades
// (hs_is_closed/hs_is_closed_won), mas fiables que inferirlas de la etapa —
// este mapa solo resuelve la etiqueta/orden/pipeline para mostrar.
const stageMap = {};
for (const p of pipelines) {
  for (const s of (p.stages || [])) {
    stageMap[s.id] = { label: s.label, order: Number(s.displayOrder) || 0, pipelineLabel: p.label };
  }
}

// --- Contactos ---
const contacts = ($('Unir paginas de contactos').item.json.results) || [];
const contactRows = contacts.map((c) => {
  const p = c.properties || {};
  return '(' + esc(clientId) + '::uuid, ' + esc(c.id) + ', ' + escNullable(p.email) + ', ' +
    (p.createdate ? esc(p.createdate) + '::timestamptz' : 'NULL') + ', ' + escNullable(p.lifecyclestage) + ', ' +
    escNullable(p.utm_campaign) + ', ' + escNullable(p.utm_source) + ', ' + escNullable(p.utm_medium) + ', ' +
    escNullable(p.utm_content) + ', ' + escNullable(p.utm_term) + ', ' + escNullable(p.hs_analytics_source) + ')';
});
const contactsUpsert = contactRows.length === 0 ? '' :
  'INSERT INTO hubspot_contacts (client_id, hubspot_contact_id, email, created_at, lifecycle_stage, utm_campaign, utm_source, utm_medium, utm_content, utm_term, original_source) VALUES ' +
  contactRows.join(', ') +
  ' ON CONFLICT (client_id, hubspot_contact_id) DO UPDATE SET email = EXCLUDED.email, created_at = EXCLUDED.created_at, lifecycle_stage = EXCLUDED.lifecycle_stage, utm_campaign = EXCLUDED.utm_campaign, utm_source = EXCLUDED.utm_source, utm_medium = EXCLUDED.utm_medium, utm_content = EXCLUDED.utm_content, utm_term = EXCLUDED.utm_term, original_source = EXCLUDED.original_source, updated_at = now();';

// --- Asociaciones deal -> contacto principal (to[0]) ---
const assocResp = $('Asociaciones deal-contacto').item.json || {};
const assocResults = assocResp.results || [];
const primaryContactByDeal = {};
for (const a of assocResults) {
  const dealId = a.from && a.from.id;
  const first = (a.to || [])[0];
  if (dealId && first) primaryContactByDeal[dealId] = first.toObjectId;
}

// --- Deals ---
const deals = ($('Unir paginas de deals').item.json.results) || [];
const dealRows = deals.map((d) => {
  const p = d.properties || {};
  const stage = stageMap[p.dealstage] || { label: null, order: null, pipelineLabel: null };
  const isClosed = p.hs_is_closed === 'true';
  const isWon = p.hs_is_closed_won === 'true';
  const primaryContactId = primaryContactByDeal[d.id] || null;
  return '(' + esc(clientId) + '::uuid, ' + esc(d.id) + ', ' + escNullable(p.dealname) + ', ' +
    escNullable(stage.pipelineLabel) + ', ' + escNullable(stage.label) + ', ' + (stage.order == null ? 'NULL' : stage.order) + ', ' +
    isClosed + ', ' + isWon + ', ' + num(p.amount) + ', ' +
    (p.createdate ? esc(p.createdate) + '::timestamptz' : 'NULL') + ', ' +
    (p.closedate ? esc(p.closedate) + '::timestamptz' : 'NULL') + ', ' + escNullable(primaryContactId) + ')';
});
const dealsUpsert = dealRows.length === 0 ? '' :
  'INSERT INTO hubspot_deals (client_id, hubspot_deal_id, name, pipeline_label, stage_label, stage_order, is_closed, is_won, amount, create_date, close_date, primary_contact_id) VALUES ' +
  dealRows.join(', ') +
  ' ON CONFLICT (client_id, hubspot_deal_id) DO UPDATE SET name = EXCLUDED.name, pipeline_label = EXCLUDED.pipeline_label, stage_label = EXCLUDED.stage_label, stage_order = EXCLUDED.stage_order, is_closed = EXCLUDED.is_closed, is_won = EXCLUDED.is_won, amount = EXCLUDED.amount, create_date = EXCLUDED.create_date, close_date = EXCLUDED.close_date, primary_contact_id = EXCLUDED.primary_contact_id, updated_at = now();';

const touchDataSource = "UPDATE data_sources SET last_sync = now(), status = 'conectado' WHERE client_id = " + esc(clientId) + "::uuid AND platform = 'hubspot';";
const records = contacts.length + deals.length;
const syncLogInsert = "INSERT INTO sync_logs (client_id, platform, status, records) VALUES (" + esc(clientId) + "::uuid, 'hubspot', 'Completado', " + records + ");";

return { json: { query: [contactsUpsert, dealsUpsert, touchDataSource, syncLogInsert].filter(Boolean).join(' '), rowCount: records } };`,
    },
    position: [2880, 180],
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
    position: [3100, 180],
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
        "INSERT INTO sync_logs (client_id, platform, status, records, error_message) VALUES ('{{ $(\"Cliente HubSpot\").item.json.client_id }}'::uuid, 'hubspot', 'Error', 0, '{{ ($json.error?.message ?? \"Error desconocido\").replace(/'/g, \"''\") }}');",
      ),
    },
    credentials: { postgres: newCredential('Supabase Postgres') },
    position: [2880, 420],
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
      errorMessage: expr('{{ $json.error?.message ?? "Error desconocido en la sincronizacion de HubSpot" }}'),
    },
    position: [3100, 420],
  },
  output: [{}],
})

export default workflow('hubspot-ingest', 'CRD - HubSpot to Supabase (ingesta diaria, multi-cliente)')
  .add(scheduleTrigger)
  .to(getClients)
  .to(mergePoint)
  .to(lookupAccount)
  .to(dateWindow)
  .to(fetchPipelines.onError(logSyncError))
  .to(fetchContacts.onError(logSyncError))
  .to(flattenContacts)
  .to(fetchDeals.onError(logSyncError))
  .to(flattenDeals)
  .to(buildAssociationsBody)
  .to(fetchAssociations.onError(logSyncError))
  .to(transform)
  .to(upsert.onError(logSyncError))
  .add(manualSyncWebhook)
  .to(normalizeWebhookPayload)
  .to(mergePoint)
  .add(logSyncError)
  .to(stopOnError)
