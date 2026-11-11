import { useMemo, useState } from 'react'
import { altitude, clock, clockSeconds } from '../lib/format'
import type { Encounter, Position } from '../types'

interface AltitudeProfileProps {
  positions: Position[]
  encounters: Encounter[]
  focusedEncounter: string | null
  onFocusEncounter: (flightId: string | null) => void
}

const WIDTH = 332
const HEIGHT = 112
const PLOT = { left: 44, right: 10, top: 10, bottom: 22 }

/** Round the altitude axis out to whole thousands of feet, with at least 4,000 ft of range */
function altitudeDomain(positions: readonly Position[]): [number, number] {
  let low = Infinity
  let high = -Infinity
  for (const { alt } of positions) {
    low = Math.min(low, alt)
    high = Math.max(high, alt)
  }
  low = Math.floor(low / 1000) * 1000
  high = Math.ceil(high / 1000) * 1000
  if (high - low < 4000) {
    const middle = (low + high) / 2
    low = Math.max(0, Math.floor((middle - 2000) / 1000) * 1000)
    high = low + 4000
  }
  return [low, high]
}

/**
 * Altitude against time for the selected flight. Each closest approach is marked at the
 * moment it happened, which ties the list of encounters back to the flight's own timeline.
 */
export function AltitudeProfile({ positions, encounters, focusedEncounter, onFocusEncounter }: AltitudeProfileProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const chart = useMemo(() => {
    const start = positions[0].ts
    const end = positions[positions.length - 1].ts
    const span = Math.max(1, end - start)
    const [low, high] = altitudeDomain(positions)
    const x = (ts: number): number => PLOT.left + ((ts - start) / span) * (WIDTH - PLOT.left - PLOT.right)
    const y = (alt: number): number => PLOT.top + (1 - (alt - low) / (high - low)) * (HEIGHT - PLOT.top - PLOT.bottom)

    // One path per continuous segment, so gaps in coverage stay gaps
    const segments = new Map<number, Position[]>()
    for (const position of positions) {
      if (!segments.has(position.seg)) segments.set(position.seg, [])
      segments.get(position.seg)!.push(position)
    }
    const baseline = HEIGHT - PLOT.bottom
    const lines: string[] = []
    const areas: string[] = []
    for (const segment of segments.values()) {
      const path = segment.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)} ${y(p.alt).toFixed(1)}`).join(' ')
      lines.push(path)
      areas.push(`${path} L${x(segment[segment.length - 1].ts).toFixed(1)} ${baseline} L${x(segment[0].ts).toFixed(1)} ${baseline} Z`)
    }
    return { start, end, low, high, x, y, lines, areas }
  }, [positions])

  const hovered = hoverIndex === null ? null : positions[hoverIndex]

  const nearest = (clientX: number, target: SVGSVGElement): number => {
    const box = target.getBoundingClientRect()
    const px = ((clientX - box.left) / box.width) * WIDTH
    let best = 0
    let bestDistance = Infinity
    positions.forEach((position, index) => {
      const distance = Math.abs(chart.x(position.ts) - px)
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    })
    return best
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-2">Altitude</span>
        <span className="text-muted tabular-nums">
          {hovered
            ? `${clockSeconds(hovered.ts)} UTC · ${altitude(hovered.alt)}`
            : `${positions.length} position reports`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full touch-none select-none"
        role="img"
        aria-label={`Altitude from ${clock(chart.start)} to ${clock(chart.end)} UTC, between ${altitude(chart.low)} and ${altitude(chart.high)}`}
        onPointerMove={(event) => setHoverIndex(nearest(event.clientX, event.currentTarget))}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* Recessive grid: top, middle and baseline */}
        {[chart.high, (chart.low + chart.high) / 2, chart.low].map((value) => (
          <g key={value}>
            <line
              x1={PLOT.left}
              x2={WIDTH - PLOT.right}
              y1={chart.y(value)}
              y2={chart.y(value)}
              stroke={value === chart.low ? '#383835' : '#2c2c2a'}
              strokeWidth="1"
            />
            <text x={PLOT.left - 6} y={chart.y(value) + 3.5} textAnchor="end" fontSize="10" fill="#898781">
              {altitude(value)}
            </text>
          </g>
        ))}
        <text x={PLOT.left} y={HEIGHT - 6} fontSize="10" fill="#898781">
          {clock(chart.start)}
        </text>
        <text x={WIDTH - PLOT.right} y={HEIGHT - 6} fontSize="10" fill="#898781" textAnchor="end">
          {clock(chart.end)} UTC
        </text>

        {chart.areas.map((path) => (
          <path key={path} d={path} fill="var(--color-own)" opacity="0.12" />
        ))}
        {chart.lines.map((path) => (
          <path key={path} d={path} fill="none" stroke="var(--color-own)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {hovered && (
          <g pointerEvents="none">
            <line
              x1={chart.x(hovered.ts)}
              x2={chart.x(hovered.ts)}
              y1={PLOT.top}
              y2={HEIGHT - PLOT.bottom}
              stroke="#898781"
              strokeWidth="1"
            />
            <circle cx={chart.x(hovered.ts)} cy={chart.y(hovered.alt)} r="4" fill="var(--color-own)" stroke="var(--color-panel)" strokeWidth="2" />
          </g>
        )}

        {/* Closest approaches, at the time and altitude of this flight */}
        {encounters.map((encounter) => {
          const ts = Date.parse(encounter.time) / 1000
          const focused = encounter.flightId === focusedEncounter
          return (
            <g
              key={encounter.flightId}
              className="cursor-pointer"
              onClick={() => onFocusEncounter(encounter.flightId)}
              onPointerEnter={() => onFocusEncounter(encounter.flightId)}
            >
              <title>{`${encounter.callsign} at ${clockSeconds(encounter.time)} UTC`}</title>
              {/* Generous transparent hit area around a small mark */}
              <circle cx={chart.x(ts)} cy={chart.y(encounter.own.alt)} r="12" fill="transparent" />
              <circle
                cx={chart.x(ts)}
                cy={chart.y(encounter.own.alt)}
                r={focused ? 5.5 : 4}
                fill="var(--color-other)"
                stroke={focused ? 'var(--color-ink)' : 'var(--color-panel)'}
                strokeWidth="2"
              />
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
