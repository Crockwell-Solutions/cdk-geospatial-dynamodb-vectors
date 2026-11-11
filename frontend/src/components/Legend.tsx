import { count } from '../lib/format'

interface LegendProps {
  flights: number
  hasSelection: boolean
  hasEncounters: boolean
  /** Distance from the left edge, clear of the side panel */
  left: number
}

/** Line keys rather than boxes: the legend mirrors the marks it explains */
function Key({ colour, label, dashed = false }: { colour: string; label: string; dashed?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true">
        <line
          x1="1"
          x2="21"
          y1="4"
          y2="4"
          stroke={colour}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={dashed ? '3 4' : undefined}
        />
      </svg>
      <span>{label}</span>
    </li>
  )
}

export function Legend({ flights, hasSelection, hasEncounters, left }: LegendProps) {
  return (
    <ul
      // Sits above the map attribution on screens too narrow to fit both side by side
      className="pointer-events-none absolute bottom-3 z-10 m-0 flex list-none flex-wrap gap-x-4 gap-y-1 rounded-lg border border-hairline bg-panel/90 px-3 py-2 text-xs text-ink-2 backdrop-blur max-xl:bottom-11 max-sm:hidden"
      style={{ left }}
    >
      <Key colour="var(--color-traffic)" label={`All ${count(flights)} flights`} />
      {hasSelection && <Key colour="var(--color-own)" label="Selected flight" />}
      {hasEncounters && <Key colour="var(--color-other)" label="Came close" />}
      {hasEncounters && <Key colour="var(--color-ink)" label="Closest approach" dashed />}
    </ul>
  )
}
