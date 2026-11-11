import { altitude, clock, clockSeconds, duration } from '../lib/format'
import type { Encounter, FlightDetail, FlightSummary } from '../types'
import { AltitudeProfile } from './AltitudeProfile'

interface FlightCardProps {
  summary: FlightSummary
  /** Arrives a moment after the summary, once the position reports have been fetched */
  detail: FlightDetail | null
  encounters: Encounter[]
  focusedEncounter: string | null
  onFocusEncounter: (flightId: string | null) => void
  onClear: () => void
}

const fixed = (value: number, digits: number): string => value.toFixed(digits)

export function FlightCard({ summary, detail, encounters, focusedEncounter, onFocusEncounter, onClear }: FlightCardProps) {
  const seconds = (Date.parse(summary.endTime) - Date.parse(summary.startTime)) / 1000

  return (
    <section aria-label={`Flight ${summary.callsign}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-own" aria-hidden="true" />
            <h2 className="truncate text-xl font-semibold tracking-tight text-ink">{summary.callsign}</h2>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            {[summary.aircraftType, summary.registration].filter(Boolean).join(' · ') || 'Aircraft type not reported'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selected flight"
          className="rounded-md p-1.5 text-muted hover:bg-white/10 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m3.5 3.5 9 9m0-9-9 9" />
          </svg>
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_auto_1fr] gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Over France (UTC)</dt>
          <dd className="text-ink tabular-nums">
            {clock(summary.startTime)}–{clock(summary.endTime)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Duration</dt>
          <dd className="text-ink">{duration(seconds)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Altitude</dt>
          <dd className="text-ink">
            {summary.minAlt === summary.maxAlt
              ? altitude(summary.maxAlt)
              : `${altitude(summary.minAlt)} to ${altitude(summary.maxAlt)}`}
          </dd>
        </div>
      </dl>

      {detail && (
        <>
          <div className="mt-3">
            <AltitudeProfile
              positions={detail.positions}
              encounters={encounters}
              focusedEncounter={focusedEncounter}
              onFocusEncounter={onFocusEncounter}
            />
          </div>

          {/* The table view of the chart above, and a look at what the vector index actually stores */}
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
              <svg viewBox="0 0 12 12" className="h-3 w-3 transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                <path d="M4 2l4 4-4 4z" />
              </svg>
              Position reports and their 4D vectors
            </summary>
            <div className="thin-scroll mt-2 max-h-52 overflow-auto rounded-md border border-hairline">
              <table className="w-full border-collapse text-right font-mono text-[11px] tabular-nums">
                <thead className="sticky top-0 bg-raised text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">Time</th>
                    <th className="px-2 py-1 font-normal">Alt ft</th>
                    <th className="px-2 py-1 font-normal">x</th>
                    <th className="px-2 py-1 font-normal">y</th>
                    <th className="px-2 py-1 font-normal">z</th>
                    <th className="px-2 py-1 font-normal">t</th>
                  </tr>
                </thead>
                <tbody className="text-ink-2">
                  {detail.positions.map((position) => (
                    <tr key={position.ts} className="border-t border-hairline">
                      <td className="px-2 py-0.5 text-left">{clockSeconds(position.ts)}</td>
                      <td className="px-2 py-0.5">{Math.round(position.alt)}</td>
                      <td className="px-2 py-0.5">{fixed(position.vec[0], 1)}</td>
                      <td className="px-2 py-0.5">{fixed(position.vec[1], 1)}</td>
                      <td className="px-2 py-0.5">{fixed(position.vec[2], 1)}</td>
                      <td className="px-2 py-0.5">{fixed(position.vec[3], 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              All four numbers are in kilometres: east, north, altitude stretched so 1,000 ft equals 5 NM, and time at 250 m per
              second.
            </p>
          </details>
        </>
      )}
    </section>
  )
}
