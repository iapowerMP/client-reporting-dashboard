import { useRef, useState } from 'react'
import { Menu, Download, Calendar, GitCompare, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDateRange, validateCustomRange, getPreviousRange } from '@/lib/dateRange'

interface TopBarProps {
  title: string
  onOpenSidebar: () => void
}

const PRESETS = ['7d', '30d', '90d'] as const

export default function TopBar({ title, onOpenSidebar }: TopBarProps) {
  const {
    preset,
    range,
    label,
    setPreset,
    setCustomRange,
    compareEnabled,
    compareRange,
    compareLabel,
    setCompareEnabled,
    setCompareRange,
  } = useDateRange()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(range.from)
  const [draftTo, setDraftTo] = useState(range.to)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [comparePickerOpen, setComparePickerOpen] = useState(false)
  const [compareDraftFrom, setCompareDraftFrom] = useState(range.from)
  const [compareDraftTo, setCompareDraftTo] = useState(range.from)
  const [compareDraftError, setCompareDraftError] = useState<string | null>(null)
  const todayRef = useRef(new Date().toISOString().slice(0, 10))

  const openPicker = () => {
    setDraftFrom(range.from)
    setDraftTo(range.to)
    setDraftError(null)
    setPickerOpen((v) => !v)
  }

  const applyCustom = () => {
    const err = validateCustomRange(draftFrom, draftTo)
    if (err) {
      setDraftError(err)
      return
    }
    setCustomRange(draftFrom, draftTo)
    setPickerOpen(false)
  }

  const openComparePicker = () => {
    const base = compareRange ?? getPreviousRange(range)
    setCompareDraftFrom(base.from)
    setCompareDraftTo(base.to)
    setCompareDraftError(null)
    setComparePickerOpen((v) => !v)
  }

  const applyCompare = () => {
    const err = validateCustomRange(compareDraftFrom, compareDraftTo)
    if (err) {
      setCompareDraftError(err)
      return
    }
    setCompareRange(compareDraftFrom, compareDraftTo)
    setComparePickerOpen(false)
  }

  const toggleCompare = () => {
    if (compareEnabled) {
      // Ya activada: el botón principal abre el selector para editar el
      // periodo B (desactivar es solo la X).
      openComparePicker()
      return
    }
    setCompareEnabled(true)
    const base = compareRange ?? getPreviousRange(range)
    setCompareDraftFrom(base.from)
    setCompareDraftTo(base.to)
    setCompareDraftError(null)
    setComparePickerOpen(true)
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-base/90 backdrop-blur">
      <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSidebar}
            className="rounded-control p-1.5 text-text-secondary hover:bg-white/10 md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Selector de rango de fechas */}
          <div className="relative">
            <div className="flex items-center rounded-control border border-border bg-card p-0.5">
              {PRESETS.map((r) => (
                <button
                  key={r}
                  onClick={() => setPreset(r)}
                  className={cn(
                    'rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors',
                    preset === r
                      ? 'bg-accent text-black'
                      : 'text-text-secondary hover:text-white',
                  )}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={openPicker}
                className={cn(
                  'flex items-center gap-1 rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors',
                  preset === 'custom'
                    ? 'bg-accent text-black'
                    : 'text-text-secondary hover:text-white',
                )}
              >
                <Calendar className="h-3.5 w-3.5" />
                {preset === 'custom' ? label : 'Personalizado'}
              </button>
            </div>

            {pickerOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-card border border-border bg-card p-4 shadow-lg">
                <p className="mb-3 text-xs text-text-secondary">
                  Elige un periodo (mínimo 1 día, máximo 24 meses).
                </p>
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-text-secondary">
                      Desde
                    </span>
                    <input
                      type="date"
                      value={draftFrom}
                      max={todayRef.current}
                      onChange={(e) => setDraftFrom(e.target.value)}
                      className="w-full rounded-control border border-border bg-base px-2 py-1.5 text-sm text-white focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-text-secondary">
                      Hasta
                    </span>
                    <input
                      type="date"
                      value={draftTo}
                      max={todayRef.current}
                      onChange={(e) => setDraftTo(e.target.value)}
                      className="w-full rounded-control border border-border bg-base px-2 py-1.5 text-sm text-white focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </label>
                </div>
                {draftError && <p className="mt-2 text-xs text-negative">{draftError}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => setPickerOpen(false)}
                    className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={applyCustom}
                    className="rounded-control bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Comparar con un segundo periodo */}
          <div className="relative">
            <button
              onClick={toggleCompare}
              className={cn(
                'flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-semibold transition-colors',
                compareEnabled
                  ? 'border-accent/60 bg-accent/10 text-accent'
                  : 'border-border bg-card text-text-secondary hover:text-white',
              )}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {compareEnabled && compareLabel ? `vs ${compareLabel}` : 'Comparar'}
              {compareEnabled && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCompareEnabled(false)
                    setComparePickerOpen(false)
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
                  aria-label="Quitar comparación"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>

            {comparePickerOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-card border border-border bg-card p-4 shadow-lg">
                <p className="mb-3 text-xs text-text-secondary">
                  Elige el periodo B a comparar contra {label} (mínimo 1 día, máximo 24 meses).
                </p>
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-text-secondary">
                      Desde
                    </span>
                    <input
                      type="date"
                      value={compareDraftFrom}
                      max={todayRef.current}
                      onChange={(e) => setCompareDraftFrom(e.target.value)}
                      className="w-full rounded-control border border-border bg-base px-2 py-1.5 text-sm text-white focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-text-secondary">
                      Hasta
                    </span>
                    <input
                      type="date"
                      value={compareDraftTo}
                      max={todayRef.current}
                      onChange={(e) => setCompareDraftTo(e.target.value)}
                      className="w-full rounded-control border border-border bg-base px-2 py-1.5 text-sm text-white focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </label>
                </div>
                {compareDraftError && <p className="mt-2 text-xs text-negative">{compareDraftError}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setComparePickerOpen(false)
                      if (!compareRange) setCompareEnabled(false)
                    }}
                    className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={applyCompare}
                    className="rounded-control bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Botón exportar (outline) */}
          <button
            className="inline-flex items-center gap-2 rounded-control border border-border bg-card px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>
    </header>
  )
}
