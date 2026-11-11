import type { CSSProperties } from 'react'
import { KM_PER_NM, count, kilometres } from '../lib/format'
import { LIMIT_RANGE } from '../lib/limits'
import type { Limits } from '../types'

interface ProximityControlsProps {
  limits: Limits
  onChange: (limits: Limits) => void
  onAnalyse: () => void
  running: boolean
  /** True when results are on screen for exactly these limits */
  upToDate: boolean
}

const PRESETS: { label: string; hint: string; limits: Limits }[] = [
  { label: '3 NM · 1,000 ft', hint: 'Separation near an airport', limits: { horizontalNm: 3, verticalFt: 1000 } },
  { label: '5 NM · 1,000 ft', hint: 'Standard en-route separation', limits: { horizontalNm: 5, verticalFt: 1000 } },
  { label: '10 NM · 2,000 ft', hint: 'Anything in the neighbourhood', limits: { horizontalNm: 10, verticalFt: 2000 } },
]

const fill = (value: number, { min, max }: { min: number; max: number }): CSSProperties =>
  ({ '--fill': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties

export function ProximityControls({ limits, onChange, onAnalyse, running, upToDate }: ProximityControlsProps) {
  return (
    <section aria-label="What counts as close">
      <h3 className="text-sm font-semibold text-ink">What counts as close?</h3>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor="horizontal" className="text-sm text-ink-2">
            Horizontal distance
          </label>
          <output htmlFor="horizontal" className="text-sm text-ink tabular-nums">
            <strong className="font-semibold">{limits.horizontalNm} NM</strong>{' '}
            <span className="text-muted">({kilometres(limits.horizontalNm * KM_PER_NM)})</span>
          </output>
        </div>
        <input
          id="horizontal"
          type="range"
          {...LIMIT_RANGE.horizontalNm}
          value={limits.horizontalNm}
          style={fill(limits.horizontalNm, LIMIT_RANGE.horizontalNm)}
          onChange={(event) => onChange({ ...limits, horizontalNm: Number(event.target.value) })}
        />
      </div>

      <div className="mt-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="vertical" className="text-sm text-ink-2">
            Altitude difference
          </label>
          <output htmlFor="vertical" className="text-sm text-ink tabular-nums">
            <strong className="font-semibold">{count(limits.verticalFt)} ft</strong>
          </output>
        </div>
        <input
          id="vertical"
          type="range"
          {...LIMIT_RANGE.verticalFt}
          value={limits.verticalFt}
          style={fill(limits.verticalFt, LIMIT_RANGE.verticalFt)}
          onChange={(event) => onChange({ ...limits, verticalFt: Number(event.target.value) })}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => {
          const chosen =
            preset.limits.horizontalNm === limits.horizontalNm && preset.limits.verticalFt === limits.verticalFt
          return (
            <button
              key={preset.label}
              type="button"
              title={preset.hint}
              aria-pressed={chosen}
              onClick={() => onChange(preset.limits)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                chosen ? 'border-ink/60 bg-white/10 text-ink' : 'border-hairline text-ink-2 hover:border-ink/40 hover:text-ink'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onAnalyse}
        disabled={running}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-page transition-colors hover:bg-white disabled:cursor-progress disabled:opacity-70"
      >
        {running ? (
          <>
            <span
              className="h-4 w-4 rounded-full border-2 border-page/30 border-t-page"
              style={{ animation: 'spin 0.7s linear infinite' }}
              aria-hidden="true"
            />
            Searching in four dimensions
          </>
        ) : upToDate ? (
          'Analyse again'
        ) : (
          'Analyse'
        )}
      </button>
    </section>
  )
}
