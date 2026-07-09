/**
 * ============================================================================
 *  mockData.ts — Datos ficticios del dashboard de reporting de Media Power
 * ----------------------------------------------------------------------------
 *  Todos los datos son inventados. Las series temporales se generan de forma
 *  determinista (RNG con semilla) para que el build y los renders sean
 *  estables. Todo está tipado con interfaces TypeScript.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Utilidades internas de generación de series                               */
/* -------------------------------------------------------------------------- */

/** Generador pseudoaleatorio determinista (LCG) para series reproducibles. */
function makeRng(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Genera una serie de `count` puntos que evoluciona de `start` a `end`
 * con una variación (ruido) natural de amplitud `noise`.
 */
function makeSeries(
  seed: number,
  start: number,
  end: number,
  noise: number,
  count = 30,
  decimals = 0,
): number[] {
  const rng = makeRng(seed)
  const factor = Math.pow(10, decimals)
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    const trend = start + (end - start) * t
    const value = trend + (rng() - 0.5) * 2 * noise
    return Math.round(Math.max(0, value) * factor) / factor
  })
}

/** Etiquetas de fecha "DD/MM" para los últimos 30 días (junio). */
export const DATE_LABELS: string[] = Array.from({ length: 30 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0')
  return `${day}/06`
})

/* -------------------------------------------------------------------------- */
/*  Tipos genéricos compartidos                                               */
/* -------------------------------------------------------------------------- */

/** Datos de un KPI para el componente KpiCard reutilizable. */
export interface KpiData {
  label: string
  value: string
  /** Texto de variación ya formateado, ej: "▲ 8,2%" (opcional). */
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
  delta: string
  deltaPositive: boolean
  /** Serie para el sparkline (30 puntos). */
  sparkline: number[]
  /** Línea de detalle inferior en gris. */
  footer: string
}

export const overviewSummary: SummaryCard[] = [
  {
    key: 'paid',
    title: 'Paid Media',
    value: '14.832€',
    delta: '▲ 8,2%',
    deltaPositive: true,
    sparkline: makeSeries(11, 380, 620, 55),
    footer: 'Conversiones: 342 · ROAS: 4,2x',
  },
  {
    key: 'seo',
    title: 'SEO',
    value: '47.291 sesiones',
    delta: '▲ 12,5%',
    deltaPositive: true,
    sparkline: makeSeries(22, 1250, 1880, 140),
    footer: 'Posición media: 8,4 · Clics GSC: 12.840',
  },
  {
    key: 'social',
    title: 'Redes Sociales',
    value: '48.720 seguidores',
    delta: '▲ 3,1%',
    deltaPositive: true,
    sparkline: makeSeries(33, 47300, 48720, 180),
    footer: 'Engagement: 4,8% · Alcance: 892.400',
  },
]

/** Punto del gráfico global de rendimiento (3 series). */
export interface GlobalPerfPoint {
  date: string
  paid: number
  seo: number
  social: number
}

export const globalPerformance: GlobalPerfPoint[] = (() => {
  const paid = makeSeries(101, 380, 620, 55)
  const seo = makeSeries(102, 1250, 1880, 150)
  const social = makeSeries(103, 24000, 34000, 3200)
  return DATE_LABELS.map((date, i) => ({
    date,
    paid: paid[i],
    seo: seo[i],
    social: social[i],
  }))
})()

/** Fila de la tabla de actividad reciente del overview. */
export interface AlertRow {
  fecha: string
  servicio: string
  detalle: string
  estado: Extract<StatusVariant, 'Revisar' | 'Positivo' | 'Destacado'>
}

export const recentActivity: AlertRow[] = [
  {
    fecha: '25/06',
    servicio: 'Paid Media',
    detalle: 'CPC en Meta Ads +22% por encima de la media del mes',
    estado: 'Revisar',
  },
  {
    fecha: '24/06',
    servicio: 'SEO',
    detalle: '3 keywords entraron en top 10 de Google',
    estado: 'Positivo',
  },
  {
    fecha: '23/06',
    servicio: 'RRSS',
    detalle: 'Reel en Instagram alcanzó 48.200 visualizaciones',
    estado: 'Destacado',
  },
  {
    fecha: '22/06',
    servicio: 'Paid Media',
    detalle: 'Campaña "Performance Max" superó objetivo de ROAS',
    estado: 'Positivo',
  },
  {
    fecha: '20/06',
    servicio: 'SEO',
    detalle: 'Tasa de rebote bajó 3 puntos vs mes anterior',
    estado: 'Positivo',
  },
]

/* ========================================================================== */
/*  VISTA 2 · PAID MEDIA                                                       */
/* ========================================================================== */

export type PaidTab = 'Todas' | 'Meta Ads' | 'Google Ads' | 'TikTok Ads'
export const PAID_TABS: PaidTab[] = ['Todas', 'Meta Ads', 'Google Ads', 'TikTok Ads']

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

export const campaigns: Campaign[] = [
  { platform: 'Meta Ads', name: 'Brand - Retargeting Web', status: 'Activa', inversion: 2340, impresiones: 189420, clics: 5280, ctr: 2.79, cpc: 0.44, conversiones: 89, roas: 5.2 },
  { platform: 'Meta Ads', name: 'Prospecting - LAL 1%', status: 'Activa', inversion: 3120, impresiones: 312800, clics: 6410, ctr: 2.05, cpc: 0.49, conversiones: 72, roas: 3.8 },
  { platform: 'Meta Ads', name: 'Awareness - Video Views', status: 'Activa', inversion: 1480, impresiones: 248600, clics: 2190, ctr: 0.88, cpc: 0.68, conversiones: 18, roas: 1.9 },
  { platform: 'Meta Ads', name: 'Conversiones - Feed', status: 'Pausada', inversion: 1480, impresiones: 156200, clics: 3840, ctr: 2.46, cpc: 0.39, conversiones: 64, roas: 4.1 },
  { platform: 'Google Ads', name: 'Brand - Search ES', status: 'Activa', inversion: 1840, impresiones: 42100, clics: 4890, ctr: 11.61, cpc: 0.38, conversiones: 68, roas: 6.8 },
  { platform: 'Google Ads', name: 'Performance Max', status: 'Activa', inversion: 1920, impresiones: 189300, clics: 3210, ctr: 1.70, cpc: 0.60, conversiones: 41, roas: 3.2 },
  { platform: 'Google Ads', name: 'Display - Remarketing', status: 'Activa', inversion: 680, impresiones: 98400, clics: 1120, ctr: 1.14, cpc: 0.61, conversiones: 12, roas: 2.6 },
  { platform: 'Google Ads', name: 'YouTube - Awareness', status: 'Pausada', inversion: 452, impresiones: 34200, clics: 890, ctr: 2.60, cpc: 0.51, conversiones: 5, roas: 1.4 },
  { platform: 'TikTok Ads', name: 'Conversiones - Spark Ads', status: 'Activa', inversion: 890, impresiones: 124500, clics: 2840, ctr: 2.28, cpc: 0.31, conversiones: 28, roas: 3.1 },
  { platform: 'TikTok Ads', name: 'Tráfico - TopFeed', status: 'Activa', inversion: 630, impresiones: 78410, clics: 1821, ctr: 2.32, cpc: 0.35, conversiones: 15, roas: 2.4 },
]

/**
 * KPIs de "Todas" tal cual los define el brief (valores destacados fijos).
 * Para tabs de plataforma se recalculan sumando sus campañas (ver computePaidKpis).
 * Los deltas son ilustrativos del mockup y se mantienen constantes.
 */
const PAID_KPI_META = [
  { label: 'Inversión', delta: '▲ 8,2%', deltaPositive: true },
  { label: 'Impresiones', delta: '▲ 5,1%', deltaPositive: true },
  { label: 'Clics', delta: '▲ 11,3%', deltaPositive: true },
  { label: 'CTR', delta: '▲ 0,15pp', deltaPositive: true },
  { label: 'CPC', delta: '▼ 3,2%', deltaPositive: true },
  { label: 'CPM', delta: '▲ 2,1%', deltaPositive: false },
  { label: 'Conversiones', delta: '▲ 15,8%', deltaPositive: true },
  { label: 'Coste/Conv', delta: '▼ 7,2%', deltaPositive: true },
  { label: 'ROAS', delta: '▲ 12,4%', deltaPositive: true },
] as const

/** Valores fijos del brief para la pestaña "Todas". */
const PAID_KPI_TODAS_VALUES: Record<string, string> = {
  Inversión: '14.832€',
  Impresiones: '1.284.930',
  Clics: '28.491',
  CTR: '2,22%',
  CPC: '0,52€',
  CPM: '11,54€',
  Conversiones: '342',
  'Coste/Conv': '43,37€',
  ROAS: '4,21x',
}

import {
  formatNumber,
  formatCurrency,
  formatPercent,
  formatRoas,
  formatDecimal,
} from '@/lib/utils'

/**
 * Recalcula los KPIs de Paid Media según la pestaña de plataforma activa.
 * "Todas" devuelve los valores destacados del brief; el resto se computa
 * sumando las campañas de esa plataforma y derivando los ratios.
 */
export function computePaidKpis(
  tab: PaidTab,
  visiblePlatforms: string[] = [...PAID_PLATFORMS],
): KpiData[] {
  const rows =
    tab === 'Todas'
      ? campaigns.filter((c) => visiblePlatforms.includes(c.platform))
      : campaigns.filter((c) => c.platform === tab)
  const allVisible = PAID_PLATFORMS.every((p) => visiblePlatforms.includes(p))

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

  const computed: Record<string, string> = {
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

  return PAID_KPI_META.map((meta) => ({
    label: meta.label,
    value:
      tab === 'Todas' && allVisible
        ? PAID_KPI_TODAS_VALUES[meta.label]
        : computed[meta.label],
    delta: meta.delta,
    deltaPositive: meta.deltaPositive,
  }))
}

/** Punto del gráfico Inversión vs Conversiones. */
export interface InvConvPoint {
  date: string
  inversion: number
  conversiones: number
}

export const paidInvConv: InvConvPoint[] = (() => {
  const inv = makeSeries(201, 380, 620, 60)
  const conv = makeSeries(202, 9, 15, 2.2)
  return DATE_LABELS.map((date, i) => ({
    date,
    inversion: inv[i],
    conversiones: conv[i],
  }))
})()

/** Segmento del donut de distribución por plataforma. */
export interface PlatformSlice {
  name: string
  value: number
  percent: string
  color: string
}

export const paidDistribution: PlatformSlice[] = [
  { name: 'Meta Ads', value: 8420, percent: '56,8%', color: '#0081FB' },
  { name: 'Google Ads', value: 4892, percent: '33,0%', color: '#34A853' },
  { name: 'TikTok Ads', value: 1520, percent: '10,2%', color: '#FF004F' },
]

export const paidDistributionTotal = '14.832€'

/** Barra del ranking Top 5 campañas por ROAS. */
export interface RoasBar {
  name: string
  roas: number
}

export const topCampaignsByRoas: RoasBar[] = [
  { name: 'Brand - Search ES', roas: 6.8 },
  { name: 'Retargeting Web', roas: 5.2 },
  { name: 'Prospecting LAL', roas: 4.1 },
  { name: 'Brand Awareness Video', roas: 3.4 },
  { name: 'Conversiones Feed', roas: 2.9 },
]

/* ========================================================================== */
/*  VISTA 3 · SEO                                                              */
/* ========================================================================== */

export type SeoTab = 'Overview' | 'GA4' | 'Search Console' | 'Semrush'
export const SEO_TABS: SeoTab[] = ['Overview', 'GA4', 'Search Console', 'Semrush']

/** Herramientas de SEO que dependen de una conexión (la pestaña "Overview" siempre está). */
export const SEO_TAB_TO_CONNECTION: Record<string, string> = {
  GA4: 'ga4',
  'Search Console': 'gsc',
  Semrush: 'semrush',
}

export const seoKpis: KpiData[] = [
  { label: 'Sesiones', value: formatNumber(47291), delta: '▲ 12,5%', deltaPositive: true },
  { label: 'Usuarios', value: formatNumber(38842), delta: '▲ 10,8%', deltaPositive: true },
  { label: 'Nuevos usuarios', value: formatNumber(31205), delta: '▲ 14,2%', deltaPositive: true },
  { label: 'Tasa de rebote', value: formatPercent(42.3, 1), delta: '▼ 3,1pp', deltaPositive: true },
  { label: 'Clics orgánicos', value: formatNumber(12840), delta: '▲ 18,4%', deltaPositive: true },
  { label: 'CTR orgánico', value: formatPercent(3.8, 1), delta: '▲ 0,4pp', deltaPositive: true },
  { label: 'Posición media', value: formatDecimal(8.4, 1), delta: '▼ 1,2', deltaPositive: true },
  { label: 'Backlinks', value: formatNumber(2841), delta: '▲ 124', deltaPositive: true },
]

/** Punto del gráfico de tráfico orgánico (sesiones + clics GSC). */
export interface SeoTrafficPoint {
  date: string
  sesiones: number
  clics: number
}

export const seoTraffic: SeoTrafficPoint[] = (() => {
  const ses = makeSeries(301, 1250, 1880, 150)
  const clk = makeSeries(302, 340, 500, 45)
  return DATE_LABELS.map((date, i) => ({
    date,
    sesiones: ses[i],
    clics: clk[i],
  }))
})()

/** Barra de tráfico por canal. */
export interface ChannelBar {
  channel: string
  value: number
  /** Solo el canal orgánico se pinta en acento. */
  organic: boolean
}

export const seoChannels: ChannelBar[] = [
  { channel: 'Organic', value: 28430, organic: true },
  { channel: 'Direct', value: 8920, organic: false },
  { channel: 'Referral', value: 4210, organic: false },
  { channel: 'Social', value: 3840, organic: false },
  { channel: 'Paid', value: 1200, organic: false },
  { channel: 'Email', value: 691, organic: false },
]

/** Punto de la evolución de posición media (eje Y invertido). */
export interface PositionPoint {
  date: string
  position: number
}

export const seoPosition: PositionPoint[] = (() => {
  const pos = makeSeries(303, 10, 8.4, 0.5, 30, 1)
  return DATE_LABELS.map((date, i) => ({ date, position: pos[i] }))
})()

/** Fila de las tablas de queries / páginas de Search Console. */
export interface GscRow {
  label: string
  clics: number
  impresiones: number
  ctr: number
  posicion: number
}

export const seoTopQueries: GscRow[] = [
  { label: 'agencia marketing digital madrid', clics: 1842, impresiones: 28400, ctr: 6.49, posicion: 3.2 },
  { label: 'agencia publicidad digital', clics: 1210, impresiones: 22100, ctr: 5.48, posicion: 4.1 },
  { label: 'campañas meta ads españa', clics: 890, impresiones: 18300, ctr: 4.86, posicion: 5.8 },
  { label: 'gestión redes sociales empresa', clics: 780, impresiones: 15600, ctr: 5.0, posicion: 6.2 },
  { label: 'consultoría seo madrid', clics: 650, impresiones: 12800, ctr: 5.08, posicion: 4.9 },
  { label: 'publicidad google ads agencia', clics: 540, impresiones: 11200, ctr: 4.82, posicion: 7.1 },
  { label: 'marketing digital pymes', clics: 480, impresiones: 14500, ctr: 3.31, posicion: 9.4 },
  { label: 'agencia tiktok ads', clics: 420, impresiones: 8900, ctr: 4.72, posicion: 8.3 },
  { label: 'estrategia contenidos redes sociales', clics: 380, impresiones: 9200, ctr: 4.13, posicion: 10.2 },
  { label: 'automatización marketing ia', clics: 340, impresiones: 6800, ctr: 5.0, posicion: 7.8 },
]

export const seoTopPages: GscRow[] = [
  { label: '/servicios/paid-media', clics: 2340, impresiones: 38200, ctr: 6.13, posicion: 4.1 },
  { label: '/blog/guia-meta-ads-2025', clics: 1890, impresiones: 32100, ctr: 5.89, posicion: 3.8 },
  { label: '/', clics: 1640, impresiones: 42800, ctr: 3.83, posicion: 6.2 },
  { label: '/servicios/seo', clics: 1280, impresiones: 21400, ctr: 5.98, posicion: 5.4 },
  { label: '/servicios/redes-sociales', clics: 980, impresiones: 18900, ctr: 5.19, posicion: 6.8 },
  { label: '/blog/tendencias-marketing-2025', clics: 840, impresiones: 15200, ctr: 5.53, posicion: 7.2 },
  { label: '/contacto', clics: 720, impresiones: 12600, ctr: 5.71, posicion: 3.2 },
  { label: '/caso-exito/ecommerce-moda', clics: 580, impresiones: 9800, ctr: 5.92, posicion: 8.1 },
]

/* ========================================================================== */
/*  VISTA 4 · REDES SOCIALES                                                   */
/* ========================================================================== */

export type SocialTab = 'Todas' | 'Instagram' | 'Facebook' | 'TikTok' | 'YouTube'
export const SOCIAL_TABS: SocialTab[] = [
  'Todas',
  'Instagram',
  'Facebook',
  'TikTok',
  'YouTube',
]

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
interface SocialPlatformStats {
  platform: Exclude<SocialTab, 'Todas'>
  seguidores: number
  crecimientoNeto: number
  alcance: number
  impresiones: number
  engagementRate: number
  publicaciones: number
}

export const socialStats: SocialPlatformStats[] = [
  { platform: 'Instagram', seguidores: 28940, crecimientoNeto: 740, alcance: 412000, impresiones: 686000, engagementRate: 5.4, publicaciones: 21 },
  { platform: 'Facebook', seguidores: 12920, crecimientoNeto: 120, alcance: 148000, impresiones: 236000, engagementRate: 2.6, publicaciones: 12 },
  { platform: 'TikTok', seguidores: 5340, crecimientoNeto: 540, alcance: 248000, impresiones: 412300, engagementRate: 6.9, publicaciones: 9 },
  { platform: 'YouTube', seguidores: 2020, crecimientoNeto: 100, alcance: 84400, impresiones: 94000, engagementRate: 3.2, publicaciones: 5 },
]

/**
 * KPIs de Redes Sociales. "Todas" muestra los totales del brief; al filtrar
 * por plataforma se recalculan a partir de socialStats.
 */
export function computeSocialKpis(
  tab: SocialTab,
  visiblePlatforms: string[] = [...SOCIAL_PLATFORMS],
): KpiData[] {
  if (tab === 'Todas') {
    const allVisible = SOCIAL_PLATFORMS.every((p) => visiblePlatforms.includes(p))
    if (allVisible) {
      return [
        { label: 'Seguidores totales', value: formatNumber(48720), delta: '▲ 3,1%', deltaPositive: true },
        { label: 'Crecimiento neto', value: `+${formatNumber(1480)}`, delta: '▲ 340 vs anterior', deltaPositive: true },
        { label: 'Alcance total', value: formatNumber(892400), delta: '▲ 7,8%', deltaPositive: true },
        { label: 'Impresiones', value: formatNumber(1428300), delta: '▲ 9,2%', deltaPositive: true },
        { label: 'Engagement Rate', value: formatPercent(4.8, 1), delta: '▲ 0,3pp', deltaPositive: true },
        { label: 'Publicaciones', value: formatNumber(47) },
      ]
    }
    // Recalcular totales sumando solo las plataformas visibles.
    const stats = socialStats.filter((s) => visiblePlatforms.includes(s.platform))
    const seguidores = stats.reduce((a, s) => a + s.seguidores, 0)
    const crecimiento = stats.reduce((a, s) => a + s.crecimientoNeto, 0)
    const alcance = stats.reduce((a, s) => a + s.alcance, 0)
    const impresiones = stats.reduce((a, s) => a + s.impresiones, 0)
    const publicaciones = stats.reduce((a, s) => a + s.publicaciones, 0)
    const engagement = stats.length
      ? stats.reduce((a, s) => a + s.engagementRate, 0) / stats.length
      : 0
    return [
      { label: 'Seguidores totales', value: formatNumber(seguidores), delta: '▲ 3,1%', deltaPositive: true },
      { label: 'Crecimiento neto', value: `+${formatNumber(crecimiento)}`, delta: '▲ vs anterior', deltaPositive: true },
      { label: 'Alcance total', value: formatNumber(alcance), delta: '▲ 7,8%', deltaPositive: true },
      { label: 'Impresiones', value: formatNumber(impresiones), delta: '▲ 9,2%', deltaPositive: true },
      { label: 'Engagement Rate', value: formatPercent(engagement, 1), delta: '▲ 0,3pp', deltaPositive: true },
      { label: 'Publicaciones', value: formatNumber(publicaciones) },
    ]
  }

  const s = socialStats.find((x) => x.platform === tab)!
  return [
    { label: 'Seguidores', value: formatNumber(s.seguidores), delta: '▲ 3,1%', deltaPositive: true },
    { label: 'Crecimiento neto', value: `+${formatNumber(s.crecimientoNeto)}`, delta: '▲ vs anterior', deltaPositive: true },
    { label: 'Alcance', value: formatNumber(s.alcance), delta: '▲ 7,8%', deltaPositive: true },
    { label: 'Impresiones', value: formatNumber(s.impresiones), delta: '▲ 9,2%', deltaPositive: true },
    { label: 'Engagement Rate', value: formatPercent(s.engagementRate, 1), delta: '▲ 0,3pp', deltaPositive: true },
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

export const socialFollowers: FollowersPoint[] = (() => {
  const ig = makeSeries(401, 28200, 28940, 90)
  const fb = makeSeries(402, 12800, 12920, 35)
  const tt = makeSeries(403, 4800, 5340, 70)
  const yt = makeSeries(404, 1920, 2020, 25)
  return DATE_LABELS.map((date, i) => ({
    date,
    Instagram: ig[i],
    Facebook: fb[i],
    TikTok: tt[i],
    YouTube: yt[i],
  }))
})()

/** Engagement por plataforma (likes / comments / shares). */
export interface EngagementBar {
  platform: Exclude<SocialTab, 'Todas'>
  likes: number
  comments: number
  shares: number
}

export const socialEngagement: EngagementBar[] = [
  { platform: 'Instagram', likes: 8420, comments: 1240, shares: 680 },
  { platform: 'Facebook', likes: 2180, comments: 340, shares: 290 },
  { platform: 'TikTok', likes: 12400, comments: 890, shares: 2100 },
  { platform: 'YouTube', likes: 1840, comments: 210, shares: 120 },
]

/** Segmento del donut de alcance por plataforma. */
export const socialReach: PlatformSlice[] = [
  { name: 'Instagram', value: 412000, percent: '46,2%', color: '#E1306C' },
  { name: 'TikTok', value: 248000, percent: '27,8%', color: '#FF004F' },
  { name: 'Facebook', value: 148000, percent: '16,6%', color: '#1877F2' },
  { name: 'YouTube', value: 84400, percent: '9,4%', color: '#FF0000' },
]

export const socialReachTotal = '892,4k'

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

export const topPosts: Post[] = [
  { id: 1, platform: 'Instagram', fecha: '22/06', caption: 'Nuevo caso de éxito: +340% ROAS en campaña de Performance Max para un cliente de moda…', alcance: 48200, likes: 2840, comments: 189 },
  { id: 2, platform: 'TikTok', fecha: '20/06', caption: '3 errores que cometen las marcas en TikTok Ads y cómo evitarlos este trimestre…', alcance: 124500, likes: 8920, comments: 342 },
  { id: 3, platform: 'Instagram', fecha: '18/06', caption: 'El equipo de Paid Media celebrando los resultados del último informe mensual…', alcance: 32100, likes: 3210, comments: 245 },
  { id: 4, platform: 'YouTube', fecha: '19/06', caption: 'Tutorial: Cómo configurar conversiones en GA4 paso a paso para e-commerce', alcance: 28400, likes: 1420, comments: 98 },
  { id: 5, platform: 'Facebook', fecha: '21/06', caption: '¿Tu empresa necesita una estrategia de contenidos? Te contamos por dónde empezar…', alcance: 18900, likes: 1280, comments: 67 },
  { id: 6, platform: 'TikTok', fecha: '17/06', caption: 'POV: cuando el ROAS del cliente sube un 200% en una sola semana de optimización…', alcance: 89200, likes: 6410, comments: 521 },
]

/* ========================================================================== */
/*  VISTA 5 · CONFIGURACIÓN                                                    */
/* ========================================================================== */

export interface ClientData {
  nombre: string
  sector: string
  sitioWeb: string
}

export const clientData: ClientData = {
  nombre: 'Cliente Demo',
  sector: 'E-commerce',
  sitioWeb: 'https://clientedemo.es',
}

export interface Connection {
  id: string
  platform: string
  label: string
  placeholder: string
  value: string
  status: Extract<StatusVariant, 'Conectado' | 'Pendiente' | 'Error'>
  lastSync: string
  errorMessage?: string
}

export const connections: Connection[] = [
  { id: 'meta-ads', platform: 'Meta Ads', label: 'Ad Account ID', placeholder: 'act_XXXXXXXXXX', value: 'act_928374651', status: 'Conectado', lastSync: 'Hace 2 horas' },
  { id: 'google-ads', platform: 'Google Ads', label: 'Customer ID', placeholder: 'XXX-XXX-XXXX', value: '847-291-0384', status: 'Conectado', lastSync: 'Hace 2 horas' },
  { id: 'tiktok-ads', platform: 'TikTok Ads', label: 'Advertiser ID', placeholder: 'XXXXXXXXXX', value: '', status: 'Pendiente', lastSync: 'Nunca' },
  { id: 'ga4', platform: 'Google Analytics 4', label: 'Property ID', placeholder: 'XXXXXXXXX', value: '384729103', status: 'Conectado', lastSync: 'Hace 3 horas' },
  { id: 'gsc', platform: 'Search Console', label: 'URL de propiedad', placeholder: 'https://tudominio.com', value: 'https://clientedemo.es', status: 'Conectado', lastSync: 'Hace 3 horas' },
  { id: 'semrush', platform: 'Semrush', label: 'Dominio', placeholder: 'tudominio.com', value: 'clientedemo.es', status: 'Conectado', lastSync: 'Hace 24 horas' },
  { id: 'instagram', platform: 'Instagram', label: 'Business Account ID', placeholder: 'XXXXXXXXXX', value: '17841405822', status: 'Conectado', lastSync: 'Hace 1 hora' },
  { id: 'facebook', platform: 'Facebook', label: 'Page ID', placeholder: 'XXXXXXXXXX', value: '109284750183', status: 'Conectado', lastSync: 'Hace 1 hora' },
  { id: 'tiktok-org', platform: 'TikTok (orgánico)', label: 'Username', placeholder: '@tuusuario', value: '', status: 'Pendiente', lastSync: 'Nunca' },
  { id: 'youtube', platform: 'YouTube', label: 'Channel ID', placeholder: 'UCXXXXXXXXXX', value: 'UCx8dk29FalPqe', status: 'Error', lastSync: 'Hace 6 horas', errorMessage: 'Error: cuota diaria de la API agotada. Reintente mañana.' },
]

export interface SyncLog {
  fechaHora: string
  plataforma: string
  estado: 'Completado' | 'Error'
  registros: string
  duracion: string
}

export const syncLogs: SyncLog[] = [
  { fechaHora: '25/06 14:32', plataforma: 'Meta Ads', estado: 'Completado', registros: '1.284 registros', duracion: '12s' },
  { fechaHora: '25/06 14:32', plataforma: 'Google Ads', estado: 'Completado', registros: '842 registros', duracion: '8s' },
  { fechaHora: '25/06 14:30', plataforma: 'Instagram', estado: 'Completado', registros: '47 posts', duracion: '4s' },
  { fechaHora: '25/06 14:30', plataforma: 'Facebook', estado: 'Completado', registros: '38 posts', duracion: '3s' },
  { fechaHora: '25/06 11:00', plataforma: 'YouTube', estado: 'Error', registros: '0 registros', duracion: '2s' },
  { fechaHora: '25/06 08:00', plataforma: 'GA4', estado: 'Completado', registros: '2.840 registros', duracion: '18s' },
  { fechaHora: '25/06 08:00', plataforma: 'Search Console', estado: 'Completado', registros: '4.210 registros', duracion: '22s' },
  { fechaHora: '24/06 20:00', plataforma: 'Semrush', estado: 'Completado', registros: '312 keywords', duracion: '9s' },
]
