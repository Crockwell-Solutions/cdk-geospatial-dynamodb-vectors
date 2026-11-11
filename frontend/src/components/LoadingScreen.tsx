import { count, longDate } from '../lib/format'
import type { LoadState } from '../lib/useFlights'

interface LoadingScreenProps {
  state: LoadState
  /** True once the flights are loaded and the map has drawn its first frame */
  mapReady: boolean
  onRetry: () => void
}

function describe(state: LoadState): { title: string; detail: string; fraction: number } {
  switch (state.phase) {
    case 'manifest':
      return { title: 'Connecting', detail: 'Asking the API what has been loaded', fraction: 0.02 }
    case 'flights':
      return state.fromCache
        ? { title: 'Loading flights', detail: 'Reading from the browser cache', fraction: 1 }
        : {
            title: 'Loading flights',
            detail: `${count(state.loaded)} of ${count(state.total)} flights`,
            fraction: Math.max(0.04, state.loaded / state.total),
          }
    case 'ready':
      return {
        title: 'Drawing the map',
        detail: `${count(state.manifest.flights)} flights${state.fromCache ? ' from the browser cache' : ''}`,
        fraction: 1,
      }
    case 'error':
      return { title: 'Could not load the flights', detail: state.message, fraction: 0 }
  }
}

/** Two flight paths drawing themselves towards a crossing: the question this app answers */
function Crossing() {
  return (
    <svg viewBox="0 0 240 150" className="h-36 w-56" aria-hidden="true">
      <path
        d="M10 118 C 70 104, 150 62, 230 26"
        fill="none"
        stroke="var(--color-own)"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        style={{ animation: 'draw-path 2.4s ease-in-out infinite alternate' }}
      />
      <path
        d="M22 22 C 80 50, 150 92, 226 128"
        fill="none"
        stroke="var(--color-other)"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        style={{ animation: 'draw-path 2.4s ease-in-out infinite alternate' }}
      />
      <g style={{ transformOrigin: '125px 74px', transformBox: 'view-box' }}>
        <circle
          cx="125"
          cy="74"
          r="7"
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          style={{ transformOrigin: '125px 74px', animation: 'pulse-ring 1.6s ease-out infinite' }}
        />
        <circle cx="125" cy="74" r="4.5" fill="var(--color-ink)" stroke="var(--color-page)" strokeWidth="2" />
      </g>
    </svg>
  )
}

export function LoadingScreen({ state, mapReady, onRetry }: LoadingScreenProps) {
  const done = state.phase === 'ready' && mapReady
  const { title, detail, fraction } = describe(state)
  const dataset = state.phase === 'flights' || state.phase === 'ready' ? state.manifest : undefined

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-page px-6 text-center transition-opacity duration-500 ${
        done ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      aria-hidden={done}
      role="status"
      aria-live="polite"
    >
      <Crossing />
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Flight Proximity</h1>
      <p className="mt-1 text-ink-2">Which aircraft came close, in space and in time?</p>
      <p className="mt-1 text-sm text-muted">
        {dataset
          ? `France · ${longDate(dataset.date)} · ${count(dataset.positions)} position reports as 4D vectors in DynamoDB`
          : 'A four-dimensional vector search on DynamoDB'}
      </p>

      {state.phase === 'error' ? (
        <div className="mt-8 max-w-md">
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-1 text-ink-2">{detail}</p>
          {state.notLoaded && (
            <p className="mt-3 text-sm text-muted">
              Deploy the stacks, then load the sample data with{' '}
              <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-ink-2">npm run load-data</code>.
            </p>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-page hover:bg-white"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-8 w-72">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-traffic transition-[width] duration-300 ease-out"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="mt-3 text-sm font-medium text-ink">{title}</p>
          <p className="text-sm text-muted tabular-nums">{detail}</p>
        </div>
      )}
    </div>
  )
}
