/**
 * ============================================================================
 *  catalog.ts — Tipos, catálogos y funciones compartidas del dashboard
 * ----------------------------------------------------------------------------
 *  No contiene datos inventados: todo lo que se muestra en el informe viene
 *  de los endpoints /api/* (Supabase). Este archivo solo define:
 *    - Los tipos compartidos entre las vistas y la capa de datos (services/).
 *    - Los catálogos de pestañas/plataformas y su relación con Configuración
 *      (qué conexión de Configuración corresponde a cada pestaña).
 *    - Las funciones que recalculan KPIs a partir de datos reales según la
 *      pestaña/plataforma activa.
 * ============================================================================
 */

/** Datos de un KPI para el componente KpiCard reutilizable. */
export interface KpiData {
  label: string
  value: string
  /** Texto de variación ya formateado, ej: "▲ 8,2%" (opcional; solo se
   * muestra cuando exista una comparación real con el periodo anterior). */
  delta?: string
  /** true → verde (bueno), false → rojo (malo). Independiente de la flecha. */
  deltaPositive?: boolean
}

export type Platform =
  | 'Meta Ads'
  | 'Google Ads'
  | 'TikTok Ads'
  | 'Instagram'
  | 'Facebook'
  | 'TikTok'
  | 'YouTube'

/** Estado de una campaña o conexión. */
export type StatusVariant =
  | 'Activa'
  | 'Pausada'
  | 'Conectado'
  | 'Pendiente'
  | 'Próximamente'
  | 'Error'
  | 'Revisar'
  | 'Positivo'
  | 'Destacado'

/* ========================================================================== */
/*  VISTA 1 · OVERVIEW                                                         */
/* ========================================================================== */

export interface SummaryCard {
  key: 'paid' | 'seo' | 'social'
  title: string
  value: string
  delta?: string
  deltaPositive?: boolean
  /** Serie para el sparkline. */
  sparkline: number[]
  /** Línea de detalle inferior en gris. */
  footer: string
}

/** Punto del gráfico global de rendimiento (3 series). */
export interface GlobalPerfPoint {
  date: string
  paid: number
  seo: number
  social: number
}

/** Fila de la tabla de actividad reciente del overview. */
export interface AlertRow {
  fecha: string
  servicio: string
  detalle: string
  estado: Extract<StatusVariant, 'Revisar' | 'Positivo' | 'Destacado'>
}

/* ========================================================================== */
/*  VISTA 2 · PAID MEDIA                                                       */
/* ========================================================================== */

export type PaidTab = 'Todas' | 'Meta Ads' | 'Google Ads' | 'TikTok Ads'

/** Plataformas de Paid Media (sin la pestaña agregada "Todas"). */
export const PAID_PLATFORMS = ['Meta Ads', 'Google Ads', 'TikTok Ads'] as const

/** Mapea cada pestaña de plataforma con el id de su conexión en Configuración. */
export const PAID_TAB_TO_CONNECTION: Record<string, string> = {
  'Meta Ads': 'meta-ads',
  'Google Ads': 'google-ads',
  'TikTok Ads': 'tiktok-ads',
}

export interface Campaign {
  platform: Extract<Platform, 'Meta Ads' | 'Google Ads' | 'TikTok Ads'>
  name: string
  status: Extract<StatusVariant, 'Activa' | 'Pausada'>
  inversion: number
  impresiones: number
  clics: number
  ctr: number
  cpc: number
  conversiones: number
  roas: number
}

const PAID_KPI_LABELS = [
  'Inversión',
  'Impresiones',
  'Clics',
  'CTR',
  'CPC',
  'CPM',
  'Conversiones',
  'Coste/Conv',
  'ROAS',
] as const

import { formatNumber, formatCurrency, formatPercent, formatRoas } from '@/lib/utils'

/**
 * Recalcula los KPIs de Paid Media a partir de las campañas reales, según la
 * pestaña de plataforma activa. Sin comparación con periodo anterior
 * todavía, así que no incluye variación (delta).
 */
export function computePaidKpis(
  tab: PaidTab,
  visiblePlatforms: string[] = [...PAID_PLATFORMS],
  data: Campaign[] = [],
): KpiData[] {
  const rows =
    tab === 'Todas'
      ? data.filter((c) => visiblePlatforms.includes(c.platform))
      : data.filter((c) => c.platform === tab)

  const inversion = rows.reduce((s, c) => s + c.inversion, 0)
  const impresiones = rows.reduce((s, c) => s + c.impresiones, 0)
  const clics = rows.reduce((s, c) => s + c.clics, 0)
  const conversiones = rows.reduce((s, c) => s + c.conversiones, 0)
  const revenue = rows.reduce((s, c) => s + c.roas * c.inversion, 0)

  const ctr = impresiones ? (clics / impresiones) * 100 : 0
  const cpc = clics ? inversion / clics : 0
  const cpm = impresiones ? (inversion / impresiones) * 1000 : 0
  const costeConv = conversiones ? inversion / conversiones : 0
  const roas = inversion ? revenue / inversion : 0

  const computed: Record<(typeof PAID_KPI_LABELS)[number], string> = {
    Inversión: formatCurrency(inversion),
    Impresiones: formatNumber(impresiones),
    Clics: formatNumber(clics),
    CTR: formatPercent(ctr),
    CPC: formatCurrency(cpc, 2),
    CPM: formatCurrency(cpm, 2),
    Conversiones: formatNumber(conversiones),
    'Coste/Conv': formatCurrency(costeConv, 2),
    ROAS: formatRoas(roas),
  }

  return PAID_KPI_LABELS.map((label) => ({ label, value: computed[label] }))
}

/** Punto del gráfico Inversión vs Conversiones. */
export interface InvConvPoint {
  date: string
  inversion: number
  conversiones: number
}

/** Segmento del donut de distribución (por plataforma o por campaña). */
export interface PlatformSlice {
  name: string
  value: number
  percent: string
  color: string
}

/** Barra del ranking Top 5 campañas por ROAS. */
export interface RoasBar {
  name: string
  roas: number
}

/* ========================================================================== */
/*  VISTA 3 · SEO                                                              */
/* ========================================================================== */

export type SeoTab = 'Overview' | 'GA4' | 'Search Console' | 'Semrush'

/** Herramientas de SEO que dependen de una conexión (la pestaña "Overview" siempre está). */
export const SEO_TAB_TO_CONNECTION: Record<string, string> = {
  GA4: 'ga4',
  'Search Console': 'gsc',
  Semrush: 'semrush',
}

/** Punto del gráfico de tráfico orgánico (sesiones GA4 + clics GSC). */
export interface SeoTrafficPoint {
  date: string
  sesiones: number
  clics: number
}

/** Barra de tráfico por canal (GA4: default channel group). */
export interface ChannelBar {
  channel: string
  value: number
  /** Solo el canal orgánico se pinta en acento. */
  organic: boolean
}

/** Punto de la evolución de posición media (eje Y invertido, Search Console). */
export interface PositionPoint {
  date: string
  position: number
}

/** Fila de las tablas de queries / páginas de Search Console. */
export interface GscRow {
  label: string
  clics: number
  impresiones: number
  ctr: number
  posicion: number
}

/* ========================================================================== */
/*  VISTA 4 · REDES SOCIALES                                                   */
/* ========================================================================== */

export type SocialTab = 'Todas' | 'Instagram' | 'Facebook' | 'TikTok' | 'YouTube'

/** Plataformas de RRSS (sin la pestaña agregada "Todas"). */
export const SOCIAL_PLATFORMS = [
  'Instagram',
  'Facebook',
  'TikTok',
  'YouTube',
] as const

/** Mapea cada pestaña de RRSS con el id de su conexión en Configuración. */
export const SOCIAL_TAB_TO_CONNECTION: Record<string, string> = {
  Instagram: 'instagram',
  Facebook: 'facebook',
  TikTok: 'tiktok-org',
  YouTube: 'youtube',
}

/** Colores por red social. */
export const SOCIAL_COLORS: Record<Exclude<SocialTab, 'Todas'>, string> = {
  Instagram: '#E1306C',
  Facebook: '#1877F2',
  TikTok: '#FF004F',
  YouTube: '#FF0000',
}

/** Datos base por plataforma para poder recalcular KPIs al filtrar. */
export interface SocialPlatformStats {
  platform: Exclude<SocialTab, 'Todas'>
  seguidores: number
  crecimientoNeto: number
  alcance: number
  impresiones: number
  engagementRate: number
  publicaciones: number
}

const EMPTY_SOCIAL_KPIS = (labels: string[]): KpiData[] =>
  labels.map((label) => ({ label, value: label.startsWith('Crecimiento') ? '+0' : formatNumber(0) }))

/**
 * Recalcula los KPIs de Redes Sociales a partir de las estadísticas reales
 * por plataforma, según la pestaña activa.
 */
export function computeSocialKpis(
  tab: SocialTab,
  visiblePlatforms: string[] = [...SOCIAL_PLATFORMS],
  data: SocialPlatformStats[] = [],
): KpiData[] {
  if (tab === 'Todas') {
    const stats = data.filter((s) => visiblePlatforms.includes(s.platform))
    const seguidores = stats.reduce((a, s) => a + s.seguidores, 0)
    const crecimiento = stats.reduce((a, s) => a + s.crecimientoNeto, 0)
    const alcance = stats.reduce((a, s) => a + s.alcance, 0)
    const impresiones = stats.reduce((a, s) => a + s.impresiones, 0)
    const publicaciones = stats.reduce((a, s) => a + s.publicaciones, 0)
    const engagement = stats.length
      ? stats.reduce((a, s) => a + s.engagementRate, 0) / stats.length
      : 0
    return [
      { label: 'Seguidores totales', value: formatNumber(seguidores) },
      { label: 'Crecimiento neto', value: `+${formatNumber(crecimiento)}` },
      { label: 'Alcance total', value: formatNumber(alcance) },
      { label: 'Impresiones', value: formatNumber(impresiones) },
      { label: 'Engagement Rate', value: formatPercent(engagement, 1) },
      { label: 'Publicaciones', value: formatNumber(publicaciones) },
    ]
  }

  const s = data.find((x) => x.platform === tab)
  if (!s) {
    return EMPTY_SOCIAL_KPIS(['Seguidores', 'Crecimiento neto', 'Alcance', 'Impresiones', 'Engagement Rate', 'Publicaciones'])
  }
  return [
    { label: 'Seguidores', value: formatNumber(s.seguidores) },
    { label: 'Crecimiento neto', value: `+${formatNumber(s.crecimientoNeto)}` },
    { label: 'Alcance', value: formatNumber(s.alcance) },
    { label: 'Impresiones', value: formatNumber(s.impresiones) },
    { label: 'Engagement Rate', value: formatPercent(s.engagementRate, 1) },
    { label: 'Publicaciones', value: formatNumber(s.publicaciones) },
  ]
}

/** Punto de la evolución de seguidores (4 series). */
export interface FollowersPoint {
  date: string
  Instagram: number
  Facebook: number
  TikTok: number
  YouTube: number
}

/** Engagement por plataforma (likes / comments / shares). */
export interface EngagementBar {
  platform: Exclude<SocialTab, 'Todas'>
  likes: number
  comments: number
  shares: number
}

/** Publicación destacada. */
export interface Post {
  id: number
  platform: Exclude<SocialTab, 'Todas'>
  fecha: string
  caption: string
  alcance: number
  likes: number
  comments: number
}

/* ========================================================================== */
/*  VISTA 5 · CONFIGURACIÓN                                                    */
/* ========================================================================== */

/** Metadatos de plataforma (id, nombre, campo, placeholder) — usados por
 * Configuración para saber qué plataformas existen, combinados con los datos
 * reales de /api/data-sources. */
export interface ConnectionCatalogEntry {
  id: string
  platform: string
  label: string
  placeholder: string
}

export const CONNECTION_CATALOG: ConnectionCatalogEntry[] = [
  { id: 'meta-ads', platform: 'Meta Ads', label: 'Ad Account ID', placeholder: 'act_XXXXXXXXXX' },
  { id: 'google-ads', platform: 'Google Ads', label: 'Customer ID', placeholder: 'XXX-XXX-XXXX' },
  { id: 'tiktok-ads', platform: 'TikTok Ads', label: 'Advertiser ID', placeholder: 'XXXXXXXXXX' },
  { id: 'ga4', platform: 'Google Analytics 4', label: 'Property ID', placeholder: 'XXXXXXXXX' },
  { id: 'gsc', platform: 'Search Console', label: 'URL de propiedad', placeholder: 'https://tudominio.com' },
  { id: 'semrush', platform: 'Semrush', label: 'Dominio', placeholder: 'tudominio.com' },
  { id: 'instagram', platform: 'Instagram', label: 'Business Account ID', placeholder: 'XXXXXXXXXX' },
  { id: 'facebook', platform: 'Facebook', label: 'Page ID', placeholder: 'XXXXXXXXXX' },
  { id: 'tiktok-org', platform: 'TikTok (orgánico)', label: 'Username', placeholder: '@tuusuario' },
  { id: 'youtube', platform: 'YouTube', label: 'Channel ID', placeholder: 'UCXXXXXXXXXX' },
]
