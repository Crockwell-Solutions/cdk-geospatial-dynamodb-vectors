import { altitude, bytes, clockSeconds, count, duration, feet, kilometres, nauticalMiles } from '../lib/format'
import type { Encounter, NearbyResult } from '../types'

interface ResultsProps {
  result: NearbyResult
  /** True when the sliders have moved since this analysis ran */
  stale: boolean
  focusedEncounter: string | null
  onFocusEncounter: (flightId: string | null) => void
  onSelectFlight: (flightId: string) => void
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-ink">{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  )
}

function EncounterRow({
  encounter,
  focused,
  onFocus,
  onSelect,
}: {
  encounter: Encounter
  focused: boolean
  onFocus: () => void
  onSelect: () => void
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={focused}
        onClick={onFocus}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onFocus()
          }
        }}
        className={`cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
          focused ? 'border-ink/50 bg-white/[0.07]' : 'border-hairline hover:border-ink/30 hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-other" aria-hidden="true" />
            <span className="truncate font-semibold text-ink">{encounter.callsign}</span>
            {encounter.aircraftType && <span className="text-xs text-muted">{encounter.aircraftType}</span>}
          </div>
          <span className="shrink-0 text-xs text-ink-2 tabular-nums">{clockSeconds(encounter.time)} UTC</span>
        </div>

        <div className="mt-1 flex items-baseline gap-4">
          <span className="text-lg leading-tight font-semibold text-ink">{nauticalMiles(encounter.horizontalNm)}</span>
          <span className="text-lg leading-tight font-semibold text-ink">{feet(encounter.verticalFt)}</span>
          <span className="ml-auto text-xs text-muted">{kilometres(encounter.horizontalKm)} apart</span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-2">
          <span>
            {altitude(encounter.other.alt)} against your {altitude(encounter.own.alt)}
            {encounter.secondsWithinLimits >= 1 && <> · close for {duration(encounter.secondsWithinLimits)}</>}
          </span>
          {focused && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSelect()
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-ink underline decoration-white/30 underline-offset-2 hover:decoration-white"
            >
              Analyse this flight
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function Results({ result, stale, focusedEncounter, onFocusEncounter, onSelectFlight }: ResultsProps) {
  const { encounters, stats, limits } = result
  const within = `${limits.horizontalNm} NM and ${count(limits.verticalFt)} ft`

  return (
    <section aria-label="Flights that came close" className={stale ? 'opacity-60' : ''}>
      <h3 className="text-sm font-semibold text-ink">
        {encounters.length === 0
          ? `Nothing came within ${within}`
          : `${count(encounters.length)} ${encounters.length === 1 ? 'flight' : 'flights'} came within ${within}`}
      </h3>
      {stale && <p className="mt-0.5 text-xs text-muted">The limits have changed since this ran.</p>}
      {encounters.length === 0 && !stale && (
        <p className="mt-1 text-sm text-ink-2">Widen the limits and analyse again to cast the net further.</p>
      )}

      {/* How the answer was found: the whole point of the demo */}
      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-white/[0.04] px-3 py-2.5">
        <Stat value={count(stats.searches)} label="vector searches" />
        <Stat value={count(stats.neighbours)} label="neighbours returned" />
        <Stat value={count(stats.candidates)} label="candidate flights" />
        <Stat value={`${count(stats.totalMs)} ms`} label="server time" />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        One search per point along the track, all in parallel, each asking for the {stats.topK} nearest position reports in 4D.
        Candidates within {kilometres(stats.candidateRadiusKm)} of vector distance were then checked exactly.
        {stats.vectorSearchBytes !== undefined && <> The index billed {bytes(stats.vectorSearchBytes)} in total.</>}
      </p>

      {encounters.length > 0 && (
        <ol className="mt-3 flex list-none flex-col gap-1.5 p-0">
          {encounters.map((encounter) => (
            <EncounterRow
              key={encounter.flightId}
              encounter={encounter}
              focused={encounter.flightId === focusedEncounter}
              onFocus={() => onFocusEncounter(encounter.flightId === focusedEncounter ? null : encounter.flightId)}
              onSelect={() => onSelectFlight(encounter.flightId)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}
