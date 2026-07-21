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
   * muestra cuando exista una comparación real con el periodo anterior — si
   * el periodo anterior fue 0, no hay base para calcular un % honesto y se
   * omite en vez de mostrar un infinito o un 0% engañoso). */
  delta?: string
  /** true → verde (bueno), false → rojo (malo), null → gris (neutro, p. ej.
   * Inversión: ni subir ni bajar es en sí "bueno"). */
  deltaPositive?: boolean | null
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
] as const

const ECOMMERCE_KPI_LABELS = ['Inversión', 'Ingresos', 'Ventas', 'Coste/Venta', 'ROAS', 'CTR'] as const
const LEADGEN_KPI_LABELS = ['Inversión', 'Leads', 'Coste/Lead', 'Tasa de conversión', 'CTR', 'CPC'] as const

/** Tipo de negocio del cliente (Configuración → Datos del cliente), cambia
 * qué KPIs de Paid Media son relevantes: null = sin definir (set genérico). */
export type BusinessType = 'leadgen' | 'ecommerce' | null

import { formatNumber, formatCurrency, formatPercent, formatRoas } from '@/lib/utils'

const round2 = (n: number) => Math.round(n * 100) / 100

interface PaidRawTotals {
  inversion: number
  impresiones: number
  clics: number
  conversiones: number
  revenue: number
  ctr: number
  cpc: number
  cpm: number
  costeConv: number
  roas: number
  tasaConversion: number
}

/** Agrega un conjunto de campañas a sus totales/ratios en bruto (sin
 * formatear) — lo comparten computePaidKpis (formatea) y computePaidDeltas
 * (compara dos periodos). */
function aggregatePaidRaw(rows: Campaign[]): PaidRawTotals {
  const inversion = rows.reduce((s, c) => s + c.inversion, 0)
  const impresiones = rows.reduce((s, c) => s + c.impresiones, 0)
  const clics = rows.reduce((s, c) => s + c.clics, 0)
  const conversiones = rows.reduce((s, c) => s + c.conversiones, 0)
  const revenue = rows.reduce((s, c) => s + c.roas * c.inversion, 0)

  return {
    inversion,
    impresiones,
    clics,
    conversiones,
    revenue,
    ctr: impresiones ? (clics / impresiones) * 100 : 0,
    cpc: clics ? inversion / clics : 0,
    cpm: impresiones ? (inversion / impresiones) * 1000 : 0,
    costeConv: conversiones ? inversion / conversiones : 0,
    roas: inversion ? revenue / inversion : 0,
    tasaConversion: clics ? (conversiones / clics) * 100 : 0,
  }
}

function filterPaidRows(tab: PaidTab, visiblePlatforms: string[], data: Campaign[]): Campaign[] {
  return tab === 'Todas'
    ? data.filter((c) => visiblePlatforms.includes(c.platform))
    : data.filter((c) => c.platform === tab)
}

/**
 * Recalcula los KPIs de Paid Media a partir de las campañas reales, según la
 * pestaña de plataforma activa y el tipo de negocio del cliente (leadgen:
 * leads y coste por lead; ecommerce: ventas e ingresos; sin definir: el set
 * genérico de siempre).
 */
export function computePaidKpis(
  tab: PaidTab,
  visiblePlatforms: string[] = [...PAID_PLATFORMS],
  data: Campaign[] = [],
  businessType: BusinessType = null,
): KpiData[] {
  const t = aggregatePaidRaw(filterPaidRows(tab, visiblePlatforms, data))

  if (businessType === 'ecommerce') {
    const computed: Record<(typeof ECOMMERCE_KPI_LABELS)[number], string> = {
      Inversión: formatCurrency(t.inversion),
      Ingresos: formatCurrency(t.revenue),
      Ventas: formatNumber(t.conversiones),
      'Coste/Venta': formatCurrency(t.costeConv, 2),
      ROAS: formatRoas(t.roas),
      CTR: formatPercent(t.ctr),
    }
    return ECOMMERCE_KPI_LABELS.map((label) => ({ label, value: computed[label] }))
  }

  if (businessType === 'leadgen') {
    const computed: Record<(typeof LEADGEN_KPI_LABELS)[number], string> = {
      Inversión: formatCurrency(t.inversion),
      Leads: formatNumber(t.conversiones),
      'Coste/Lead': formatCurrency(t.costeConv, 2),
      'Tasa de conversión': formatPercent(t.tasaConversion),
      CTR: formatPercent(t.ctr),
      CPC: formatCurrency(t.cpc, 2),
    }
    return LEADGEN_KPI_LABELS.map((label) => ({ label, value: computed[label] }))
  }

  const computed: Record<(typeof PAID_KPI_LABELS)[number], string> = {
    Inversión: formatCurrency(t.inversion),
    Impresiones: formatNumber(t.impresiones),
    Clics: formatNumber(t.clics),
    CTR: formatPercent(t.ctr),
    CPC: formatCurrency(t.cpc, 2),
    CPM: formatCurrency(t.cpm, 2),
    Conversiones: formatNumber(t.conversiones),
    'Coste/Conv': formatCurrency(t.costeConv, 2),
  }

  return PAID_KPI_LABELS.map((label) => ({ label, value: computed[label] }))
}

type MetricPolarity = 'higher' | 'lower' | 'neutral'

/** Si subir el valor de esta métrica es bueno (higher), malo (lower) o
 * indiferente (neutral) — decide el color (verde/rojo/gris) de su delta. */
const METRIC_POLARITY: Record<string, MetricPolarity> = {
  Inversión: 'neutral',
  Impresiones: 'higher',
  Clics: 'higher',
  CTR: 'higher',
  CPC: 'lower',
  CPM: 'lower',
  Conversiones: 'higher',
  'Coste/Conv': 'lower',
  ROAS: 'higher',
  Ingresos: 'higher',
  Ventas: 'higher',
  'Coste/Venta': 'lower',
  Leads: 'higher',
  'Coste/Lead': 'lower',
  'Tasa de conversión': 'higher',
}

/**
 * Calcula la variación % de cada KPI de Paid Media frente al periodo
 * anterior (misma duración, inmediatamente antes del rango activo). Si el
 * periodo anterior fue 0 para una métrica, se omite (no hay base honesta
 * para expresar un %).
 */
export function computePaidDeltas(
  tab: PaidTab,
  visiblePlatforms: string[],
  currentData: Campaign[],
  previousData: Campaign[],
  businessType: BusinessType,
): Record<string, { delta: string; deltaPositive: boolean | null }> {
  const cur = aggregatePaidRaw(filterPaidRows(tab, visiblePlatforms, currentData))
  const prev = aggregatePaidRaw(filterPaidRows(tab, visiblePlatforms, previousData))

  const labels =
    businessType === 'ecommerce' ? ECOMMERCE_KPI_LABELS : businessType === 'leadgen' ? LEADGEN_KPI_LABELS : PAID_KPI_LABELS

  const rawByLabel: Record<string, [number, number]> = {
    Inversión: [cur.inversion, prev.inversion],
    Impresiones: [cur.impresiones, prev.impresiones],
    Clics: [cur.clics, prev.clics],
    CTR: [cur.ctr, prev.ctr],
    CPC: [cur.cpc, prev.cpc],
    CPM: [cur.cpm, prev.cpm],
    Conversiones: [cur.conversiones, prev.conversiones],
    'Coste/Conv': [cur.costeConv, prev.costeConv],
    ROAS: [cur.roas, prev.roas],
    Ingresos: [cur.revenue, prev.revenue],
    Ventas: [cur.conversiones, prev.conversiones],
    'Coste/Venta': [cur.costeConv, prev.costeConv],
    Leads: [cur.conversiones, prev.conversiones],
    'Coste/Lead': [cur.costeConv, prev.costeConv],
    'Tasa de conversión': [cur.tasaConversion, prev.tasaConversion],
  }

  const result: Record<string, { delta: string; deltaPositive: boolean | null }> = {}
  for (const label of labels) {
    const pair = rawByLabel[label]
    if (!pair) continue
    const [c, p] = pair
    if (!p) continue
    const pct = ((c - p) / Math.abs(p)) * 100
    const polarity = METRIC_POLARITY[label] ?? 'neutral'
    const deltaPositive = polarity === 'neutral' ? null : polarity === 'higher' ? pct >= 0 : pct <= 0
    const arrow = pct >= 0 ? '▲' : '▼'
    result[label] = { delta: `${arrow} ${formatPercent(Math.abs(pct), 1)}`, deltaPositive }
  }
  return result
}

/** Paso del funnel Impresiones → Clics → Leads/Ventas. */
export interface FunnelStep {
  label: string
  value: number
  displayValue: string
}

/** Métrica de eficiencia mostrada entre dos pasos del funnel (CTR entre
 * impresiones→clics, CPL/Coste-Venta entre clics→conversiones). */
export interface FunnelTransition {
  label: string
  value: string
}

/** Funnel simplificado (sin datos de landing/CRM todavía): Impresiones →
 * Clics → Leads/Ventas/Conversiones, con CTR y CPL/Coste-Venta como métricas
 * de paso — construido íntegramente a partir de las campañas ya ingeridas. */
export function computeFunnel(
  rows: Campaign[],
  businessType: BusinessType,
): { steps: FunnelStep[]; transitions: FunnelTransition[] } {
  const t = aggregatePaidRaw(rows)
  const lastLabel = businessType === 'ecommerce' ? 'Ventas' : businessType === 'leadgen' ? 'Leads' : 'Conversiones'

  return {
    steps: [
      { label: 'Impresiones', value: t.impresiones, displayValue: formatNumber(t.impresiones) },
      { label: 'Clics', value: t.clics, displayValue: formatNumber(t.clics) },
      { label: lastLabel, value: t.conversiones, displayValue: formatNumber(t.conversiones) },
    ],
    transitions: [
      { label: 'CTR', value: formatPercent(t.ctr) },
      { label: 'Tasa de conversión', value: formatPercent(t.tasaConversion) },
    ],
  }
}

/** Punto del scatter de eficiencia vs volumen por campaña (x = resultado,
 * y = coste por resultado o ROAS, z = tamaño de burbuja = inversión). */
export interface ScatterPoint {
  name: string
  x: number
  y: number
  z: number
}

export function computeScatterPoints(rows: Campaign[], businessType: BusinessType): ScatterPoint[] {
  return rows.map((r) => ({
    name: r.name,
    x: businessType === 'ecommerce' ? round2(r.roas * r.inversion) : r.conversiones,
    y: businessType === 'ecommerce' ? r.roas : r.conversiones ? round2(r.inversion / r.conversiones) : 0,
    z: r.inversion,
  }))
}

type PlatformShareRow = { metric: string } & Record<string, number | string>

/** Datos para la barra horizontal 100% apilada "Comparativa plataformas":
 * dos filas (Gasto y Leads/Ingresos), una columna por plataforma visible. */
export function computePlatformShareData(
  rows: Campaign[],
  visiblePlatforms: string[],
  businessType: BusinessType,
): PlatformShareRow[] {
  const resultLabel = businessType === 'ecommerce' ? 'Ingresos' : businessType === 'leadgen' ? 'Leads' : 'Conversiones'
  const gastoRow: PlatformShareRow = { metric: 'Gasto' }
  const resultRow: PlatformShareRow = { metric: resultLabel }
  for (const p of visiblePlatforms) {
    const platRows = rows.filter((r) => r.platform === p)
    gastoRow[p] = round2(platRows.reduce((s, r) => s + r.inversion, 0))
    resultRow[p] = round2(
      businessType === 'ecommerce'
        ? platRows.reduce((s, r) => s + r.roas * r.inversion, 0)
        : platRows.reduce((s, r) => s + r.conversiones, 0),
    )
  }
  return [gastoRow, resultRow]
}

/** Punto del gráfico Inversión/Leads/Ingresos vs CPL/ROAS. */
export interface InvConvPoint {
  date: string
  inversion: number
  conversiones: number
  ingresos: number
}

/** Segmento del donut de distribución (por plataforma o por campaña) —
 * también lo usa Redes Sociales para "Alcance por plataforma". */
export interface PlatformSlice {
  name: string
  value: number
  percent: string
  color: string
}

/** Fila de la tabla de creatividades de Meta Ads (nivel anuncio). */
export interface MetaCreative {
  name: string
  format: string
  impresiones: number
  clics: number
  ctr: number
  conversiones: number
  costeConv: number
  roas: number
  frecuencia: number
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
