/**
 * Tipos de la capa de datos. Cada vista consume un "bundle" tipado que el
 * proveedor activo (mock o real) debe devolver con la misma forma. Así, pasar
 * de datos ficticios a datos reales no requiere tocar las vistas.
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
  ClientData,
  Connection,
  SyncLog,
} from '@/data/mockData'

export interface OverviewData {
  summary: SummaryCard[]
  globalPerformance: GlobalPerfPoint[]
  recentActivity: AlertRow[]
}

export interface PaidData {
  campaigns: Campaign[]
  invConv: InvConvPoint[]
  distribution: PlatformSlice[]
  topRoas: RoasBar[]
}

export interface SeoData {
  kpis: KpiData[]
  traffic: SeoTrafficPoint[]
  channels: ChannelBar[]
  position: PositionPoint[]
  topQueries: GscRow[]
  topPages: GscRow[]
}

export interface SocialData {
  stats: SocialPlatformStats[]
  followers: FollowersPoint[]
  engagement: EngagementBar[]
  reach: PlatformSlice[]
  posts: Post[]
}

export interface SettingsData {
  client: ClientData
  connections: Connection[]
  syncLogs: SyncLog[]
}

export type DataMode = 'mock' | 'live'

/**
 * Contrato que cualquier proveedor de datos debe cumplir. Los métodos son
 * asíncronos porque los datos reales llegarán por red (Vercel Functions).
 */
export interface DataProvider {
  readonly mode: DataMode
  getOverview(client: string): Promise<OverviewData>
  getPaid(client: string): Promise<PaidData>
  getSeo(client: string): Promise<SeoData>
  getSocial(client: string): Promise<SocialData>
  getSettings(client: string): Promise<SettingsData>
}
