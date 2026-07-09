/**
 * Proveedor de datos ficticios. Devuelve el contenido de mockData.ts envuelto
 * en promesas para respetar el contrato asíncrono de DataProvider.
 */
import type { DataProvider } from './types'
import {
  overviewSummary,
  globalPerformance,
  recentActivity,
  campaigns,
  paidInvConv,
  paidDistribution,
  topCampaignsByRoas,
  seoKpis,
  seoTraffic,
  seoChannels,
  seoPosition,
  seoTopQueries,
  seoTopPages,
  socialStats,
  socialFollowers,
  socialEngagement,
  socialReach,
  topPosts,
  clientData,
  connections,
  syncLogs,
} from '@/data/mockData'

export const mockProvider: DataProvider = {
  mode: 'mock',

  async getOverview() {
    return {
      summary: overviewSummary,
      globalPerformance,
      recentActivity,
    }
  },

  async getPaid() {
    return {
      campaigns,
      invConv: paidInvConv,
      distribution: paidDistribution,
      topRoas: topCampaignsByRoas,
    }
  },

  async getSeo() {
    return {
      kpis: seoKpis,
      traffic: seoTraffic,
      channels: seoChannels,
      position: seoPosition,
      topQueries: seoTopQueries,
      topPages: seoTopPages,
    }
  },

  async getSocial() {
    return {
      stats: socialStats,
      followers: socialFollowers,
      engagement: socialEngagement,
      reach: socialReach,
      posts: topPosts,
    }
  },

  async getSettings() {
    return {
      client: clientData,
      connections,
      syncLogs,
    }
  },
}
