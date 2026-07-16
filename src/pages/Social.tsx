import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { Eye, Heart, MessageCircle } from 'lucide-react'
import ChartCard from '@/components/shared/ChartCard'
import ChartTooltip from '@/components/shared/ChartTooltip'
import Tabs from '@/components/shared/Tabs'
import KpiCard from '@/components/shared/KpiCard'
import PlatformBadge from '@/components/shared/PlatformBadge'
import { formatCompact, formatNumber } from '@/lib/utils'
import {
  SOCIAL_PLATFORMS,
  SOCIAL_TAB_TO_CONNECTION,
  SOCIAL_COLORS,
  type SocialTab,
  computeSocialKpis,
  type Post,
} from '@/data/catalog'
import { useReportConfig } from '@/lib/reportConfig'
import { getProvider } from '@/services'
import { useAsyncData } from '@/lib/useAsyncData'
import { useDateRange } from '@/lib/dateRange'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import NotContracted from '@/components/shared/NotContracted'

function PostCard({ post }: { post: Post }) {
  const color = SOCIAL_COLORS[post.platform]
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card transition-colors hover:bg-white/[0.03]">
      {/* Placeholder de imagen 1:1 con color de plataforma */}
      <div
        className="relative aspect-square w-full"
        style={{ backgroundColor: `${color}33` }}
      >
        <div className="absolute left-3 top-3">
          <PlatformBadge platform={post.platform} />
        </div>
      </div>
      <div className="p-4">
        <p className="text-xs text-text-secondary">{post.fecha}</p>
        <p className="mt-1 line-clamp-2 text-sm text-text-primary">
          {post.caption}
        </p>
        <div className="mt-3 flex items-center gap-4 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {formatNumber(post.alcance)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            {formatNumber(post.likes)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
            {formatNumber(post.comments)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Social() {
  const { clientSlug = '' } = useParams()
  const { isVisible } = useReportConfig()
  const [tab, setTab] = useState<SocialTab>('Todas')
  const { range } = useDateRange()
  const { data, loading, error } = useAsyncData(
    () => getProvider().getSocial(clientSlug, range),
    [clientSlug, range.from, range.to],
  )

  // Solo se muestran las redes activadas en Configuración.
  const platformTabs = SOCIAL_PLATFORMS.filter((p) =>
    isVisible(SOCIAL_TAB_TO_CONNECTION[p]),
  )
  const visibleTabs: SocialTab[] = ['Todas', ...platformTabs]
  const activeTab: SocialTab = visibleTabs.includes(tab) ? tab : 'Todas'
  const visiblePlatforms: string[] = [...platformTabs]

  if (platformTabs.length === 0) return <NotContracted label="Redes Sociales" />

  if (loading) return <Loading />
  if (error || !data)
    return <ErrorState message={error ?? 'No se pudieron cargar los datos.'} />

  const kpis = computeSocialKpis(activeTab, visiblePlatforms, data.stats)

  // Series de seguidores visibles según la pestaña.
  const followerKeys = activeTab === 'Todas' ? platformTabs : [activeTab]

  // Engagement filtrado por plataforma.
  const engagementData =
    activeTab === 'Todas'
      ? data.engagement.filter((e) => visiblePlatforms.includes(e.platform))
      : data.engagement.filter((e) => e.platform === activeTab)

  // Alcance (donut) filtrado por plataforma.
  const reachData =
    activeTab === 'Todas'
      ? data.reach.filter((r) => visiblePlatforms.includes(r.name))
      : data.reach.filter((r) => r.name === activeTab)
  const reachCenter =
    activeTab === 'Todas'
      ? formatCompact(reachData.reduce((s, r) => s + r.value, 0))
      : formatCompact(reachData[0]?.value ?? 0)

  // Posts filtrados por plataforma.
  const posts =
    activeTab === 'Todas'
      ? data.posts.filter((p) => visiblePlatforms.includes(p.platform))
      : data.posts.filter((p) => p.platform === activeTab)

  return (
    <div className="space-y-6">
      {/* Tabs (filtran el contenido) */}
      <Tabs tabs={visibleTabs} active={activeTab} onChange={setTab} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Gráfico 1: Evolución de seguidores */}
      <ChartCard title="Evolución de seguidores — Últimos 30 días">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.followers}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#2A2D36' }}
                interval={4}
              />
              <YAxis
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatCompact(v as number)}
                width={44}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
                cursor={{ stroke: '#2A2D36' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="plainline" />
              {followerKeys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={SOCIAL_COLORS[key]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Fila de 2 gráficos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gráfico 2: Engagement por plataforma (barras agrupadas) */}
        <ChartCard title="Engagement por plataforma">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={engagementData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D36" vertical={false} />
                <XAxis
                  dataKey="platform"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#2A2D36' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatCompact(v as number)}
                  width={44}
                />
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="likes" name="Likes" fill="#F2FE54" radius={[3, 3, 0, 0]} />
                <Bar dataKey="comments" name="Comments" fill="#60A5FA" radius={[3, 3, 0, 0]} />
                <Bar dataKey="shares" name="Shares" fill="#A78BFA" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Gráfico 3: Alcance por plataforma (donut) */}
        <ChartCard title="Alcance por plataforma">
          <div className="relative h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={reachData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={2}
                  stroke="none"
                >
                  {reachData.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-white">{reachCenter}</span>
              <span className="text-xs text-text-secondary">Alcance total</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-4">
            {reachData.map((slice) => (
              <div key={slice.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-text-secondary">
                  {slice.name} · {slice.percent}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Grid de Top Posts */}
      <ChartCard title="Publicaciones destacadas">
        {posts.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            No hay publicaciones para esta plataforma.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  )
}
