/**
 * Tipos de la capa de datos. Cada vista consume un "bundle" tipado que llega
 * de los endpoints /api/* (Supabase), con la misma forma para cualquier
 * cliente.
 */
import type {
  SummaryCard,
  GlobalPerfPoint,
  AlertRow,
  Campaign,
  InvConvPoint,
  PlatformSlice,
  RoasBar,
  KpiData,
  SeoTrafficPoint,
  ChannelBar,
  PositionPoint,
  GscRow,
  FollowersPoint,
  EngagementBar,
  Post,
  SocialPlatformStats,
} from '@/data/catalog'

export interface OverviewData {
  summary: SummaryCard[]
  globalPerformance: GlobalPerfPoint[]
  recentActivity: AlertRow[]
}

export interface PaidData {
  campaigns: Campaign[]
  invConv: InvConvPoint[]
  /** Misma serie que `invConv` pero exclusiva de cada plataforma, para que
   * las pestañas de plataforma no mezclen inversión/conversiones de otras. */
  invConvByPlatform: Record<string, InvConvPoint[]>
  distribution: PlatformSlice[]
  topRoas: RoasBar[]
}

export interface SeoData {
  /** Vista combinada de "Overview" (todas las herramientas conectadas). */
  kpis: KpiData[]
  traffic: SeoTrafficPoint[]
  channels: ChannelBar[]
  position: PositionPoint[]
  topQueries: GscRow[]
  topPages: GscRow[]
  /** Igual que arriba pero exclusivo de cada herramienta, para que las
   * pestañas de GA4 / Search Console no mezclen datos de otras. */
  kpisByTool: Record<'GA4' | 'Search Console', KpiData[]>
  trafficByTool: Record<'GA4' | 'Search Console', SeoTrafficPoint[]>
}

export interface SocialData {
  stats: SocialPlatformStats[]
  followers: FollowersPoint[]
  engagement: EngagementBar[]
  reach: PlatformSlice[]
  posts: Post[]
}

/** Rango de fechas del selector del informe (7d/30d/90d o personalizado). */
export interface DateRange {
  from: string
  to: string
}

/**
 * Contrato que el proveedor de datos debe cumplir. Los métodos son
 * asíncronos porque los datos llegan por red (Vercel Functions).
 */
export interface DataProvider {
  getOverview(client: string, range: DateRange): Promise<OverviewData>
  getPaid(client: string, range: DateRange): Promise<PaidData>
  getSeo(client: string, range: DateRange): Promise<SeoData>
  getSocial(client: string, range: DateRange): Promise<SocialData>
}
