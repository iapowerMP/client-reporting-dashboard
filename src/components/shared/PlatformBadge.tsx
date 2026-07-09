import { cn } from '@/lib/utils'

interface PlatformBadgeProps {
  platform: string
  className?: string
}

/** Color de acento por plataforma. */
const PLATFORM_COLORS: Record<string, string> = {
  'Meta Ads': '#0081FB',
  Meta: '#0081FB',
  'Google Ads': '#34A853',
  Google: '#34A853',
  'TikTok Ads': '#FF004F',
  TikTok: '#FF004F',
  Instagram: '#E1306C',
  Facebook: '#1877F2',
  YouTube: '#FF0000',
}

export default function PlatformBadge({ platform, className }: PlatformBadgeProps) {
  const color = PLATFORM_COLORS[platform] ?? '#9CA3AF'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: `${color}22`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {platform}
    </span>
  )
}
