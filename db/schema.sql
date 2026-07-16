-- ============================================================================
--  Esquema de base de datos (Supabase / PostgreSQL)
--  Arquitectura: n8n (ingesta programada) → esta BD → dashboard lee vía /api/*
-- ----------------------------------------------------------------------------
--  Ejecutar en Supabase: SQL Editor → pegar y ejecutar.
--  Las Vercel Functions leen con la SERVICE ROLE KEY (lado servidor), por lo
--  que de momento no se definen políticas RLS para acceso público.
-- ============================================================================

-- Extensión para UUIDs
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
--  Clientes
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  slug                 text not null unique, -- identifica al cliente en la URL: /c/<slug>/...
  sector               text,
  website              text,
  logo_url             text,
  access_password_hash text,  -- "salt:hash" (scrypt); null = informe sin contraseña
  created_at           timestamptz not null default now()
);

-- Bucket público para los logos de cliente (sube /api/upload-logo con la
-- service role key; la lectura pública no necesita políticas RLS).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
--  Fuentes de datos conectadas por cliente (una fila por plataforma).
--  `config` guarda IDs no secretos (p. ej. customer_id de Google Ads).
--  Los SECRETOS (tokens/refresh tokens) NO van aquí: viven en las credenciales
--  de n8n / variables de entorno del servidor.
-- ----------------------------------------------------------------------------
create table if not exists data_sources (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references clients(id) on delete cascade,
  platform               text not null,               -- 'google-ads', 'meta-ads', 'ga4'...
  external_id            text,                         -- customer_id, property_id, etc.
  status                 text not null default 'pendiente',  -- conectado | pendiente | error
  visible                boolean not null default true,      -- mostrar en el informe
  last_sync              timestamptz,
  config                 jsonb not null default '{}'::jsonb,
  -- Método de conexión: 'api' (ID de cuenta + credencial compartida del
  -- System User) u 'oauth' (el propio PM/cliente inicia sesión con Facebook
  -- y concede acceso a las cuentas que él mismo administra, sin necesitar
  -- estar en nuestro Business Manager). El token de oauth es de ESE usuario,
  -- no compartido entre clientes.
  auth_method            text not null default 'api',
  oauth_access_token     text,                         -- solo si auth_method = 'oauth' (Meta: token de larga duración, listo para usar)
  oauth_token_expires_at timestamptz,
  -- Google (GA4, y futuras integraciones de Google) usa un modelo distinto:
  -- el refresh token no caduca por sí solo, pero hay que canjearlo por un
  -- access token nuevo antes de cada consulta (lo hace el workflow de n8n).
  oauth_refresh_token    text,
  unique (client_id, platform)
);

-- ----------------------------------------------------------------------------
--  Google Ads — métricas diarias por campaña (granularidad día).
--  De aquí se derivan: tabla de campañas (agregada por rango), serie
--  Inversión vs Conversiones (agregada por día) y Top campañas por ROAS.
-- ----------------------------------------------------------------------------
create table if not exists gads_campaign_daily (
  id                 bigint generated always as identity primary key,
  client_id          uuid not null references clients(id) on delete cascade,
  customer_id        text,                    -- cuenta de Google Ads que originó la fila; permite
                                               -- ignorar datos de una cuenta anterior si el cliente cambia de ID
  date               date not null,
  campaign_id        text not null,
  campaign_name      text not null,
  status             text,                    -- 'Activa' | 'Pausada'
  cost               numeric(14,2) not null default 0,   -- € (ya convertido de micros)
  impressions        bigint not null default 0,
  clicks             bigint not null default 0,
  conversions        numeric(14,2) not null default 0,
  conversions_value  numeric(14,2) not null default 0,   -- valor de conversión (para ROAS)
  updated_at         timestamptz not null default now(),
  unique (client_id, date, campaign_id)
);

create index if not exists idx_gads_daily_client_date
  on gads_campaign_daily (client_id, date);

-- ----------------------------------------------------------------------------
--  Meta Ads — métricas diarias por campaña (granularidad día). Misma forma
--  que gads_campaign_daily; ad_account_id permite ignorar datos de una
--  cuenta anterior si el cliente cambia de Ad Account ID.
-- ----------------------------------------------------------------------------
create table if not exists meta_campaign_daily (
  id                 bigint generated always as identity primary key,
  client_id          uuid not null references clients(id) on delete cascade,
  ad_account_id      text,                    -- cuenta de Meta Ads que originó la fila (act_XXXXXXXXXX)
  date               date not null,
  campaign_id        text not null,
  campaign_name      text not null,
  status             text,                    -- 'Activa' | 'Pausada'
  cost               numeric(14,2) not null default 0,   -- €
  impressions        bigint not null default 0,
  clicks             bigint not null default 0,
  conversions        numeric(14,2) not null default 0,
  conversions_value  numeric(14,2) not null default 0,   -- valor de conversión (para ROAS)
  updated_at         timestamptz not null default now(),
  unique (client_id, date, campaign_id)
);

create index if not exists idx_meta_daily_client_date
  on meta_campaign_daily (client_id, date);

-- ----------------------------------------------------------------------------
--  Google Analytics 4 — métricas diarias por canal (granularidad día+canal).
--  property_id identifica la propiedad GA4 que originó la fila (permite
--  ignorar datos de una propiedad anterior si el cliente cambia de cuenta,
--  igual que customer_id/ad_account_id en paid media). channel es el
--  "default channel group" de GA4 (Organic Search, Direct, Referral...).
--  Simplificación actual: sessions/users/newUsers se suman por canal y día;
--  sumar "users" (usuarios únicos) entre canales o días es una aproximación
--  razonable para un V1, pero no es matemáticamente exacto (GA4 no permite
--  sumar usuarios únicos sin inflar el total). engaged_sessions permite
--  derivar una tasa de rebote agregada (1 - engaged/sessions).
-- ----------------------------------------------------------------------------
create table if not exists ga4_daily (
  id                 bigint generated always as identity primary key,
  client_id          uuid not null references clients(id) on delete cascade,
  property_id        text,                    -- "properties/XXXXXXXXX"
  date               date not null,
  channel            text not null,           -- Organic Search | Direct | Referral | Social | Paid Search | Email...
  sessions           bigint not null default 0,
  users              bigint not null default 0,
  new_users          bigint not null default 0,
  engaged_sessions   bigint not null default 0,
  conversions        numeric(14,2) not null default 0,
  updated_at         timestamptz not null default now(),
  unique (client_id, date, channel)
);

create index if not exists idx_ga4_daily_client_date
  on ga4_daily (client_id, date);

-- ----------------------------------------------------------------------------
--  Search Console — dos tablas porque la Search Analytics API se consulta
--  por separado según la dimensión que interese (query o página); combinarlas
--  en una sola tabla mezclaría ambas dimensiones en la misma fila. site_url
--  identifica la propiedad verificada (permite ignorar datos de una
--  propiedad anterior si el cliente cambia de sitio, igual que property_id
--  en GA4). position es la posición media ponderada por impresiones.
-- ----------------------------------------------------------------------------
create table if not exists gsc_query_daily (
  id            bigint generated always as identity primary key,
  client_id     uuid not null references clients(id) on delete cascade,
  site_url      text,                    -- "https://dominio.com/" o "sc-domain:dominio.com"
  date          date not null,
  query         text not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  ctr           numeric(6,4) not null default 0,
  position      numeric(6,2) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (client_id, date, query)
);

create index if not exists idx_gsc_query_daily_client_date
  on gsc_query_daily (client_id, date);

create table if not exists gsc_page_daily (
  id            bigint generated always as identity primary key,
  client_id     uuid not null references clients(id) on delete cascade,
  site_url      text,
  date          date not null,
  page          text not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  ctr           numeric(6,4) not null default 0,
  position      numeric(6,2) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (client_id, date, page)
);

create index if not exists idx_gsc_page_daily_client_date
  on gsc_page_daily (client_id, date);

-- ----------------------------------------------------------------------------
--  Registro de sincronizaciones (alimenta "Historial de sincronizaciones").
-- ----------------------------------------------------------------------------
create table if not exists sync_logs (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references clients(id) on delete cascade,
  platform    text not null,
  status      text not null,                  -- 'Completado' | 'Error'
  records     integer not null default 0,
  duration_s  integer,
  ran_at      timestamptz not null default now()
);

create index if not exists idx_sync_logs_client
  on sync_logs (client_id, ran_at desc);
