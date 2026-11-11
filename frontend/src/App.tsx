import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlightCard } from './components/FlightCard'
import { Legend } from './components/Legend'
import { LoadingScreen } from './components/LoadingScreen'
import { MapView } from './components/MapView'
import { ProximityControls } from './components/ProximityControls'
import { Results } from './components/Results'
import { SearchBox } from './components/SearchBox'
import { findNearbyFlights, getFlight } from './lib/api'
import { count, longDate } from './lib/format'
import { DEFAULT_LIMITS, LIMIT_RANGE } from './lib/limits'
import { useFlights } from './lib/useFlights'
import { useMediaQuery } from './lib/useMediaQuery'
import type { FlightDetail, Limits, NearbyResult } from './types'

const PANEL_WIDTH = 392
const RESULTS_WIDTH = 348
/** Share of the screen height the panel takes when it is a bottom sheet */
const COMPACT_PANEL_HEIGHT = 0.5

type Analysis =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: NearbyResult }
  | { status: 'error'; message: string }

const clamp = (value: number, { min, max }: { min: number; max: number }): number => Math.min(max, Math.max(min, value))

/** The selection and limits live in the URL, so a view can be bookmarked or shared */
function readUrl(): { flightId: string | null; limits: Limits; analyse: boolean } {
  const params = new URLSearchParams(window.location.search)
  const horizontalNm = Number(params.get('h'))
  const verticalFt = Number(params.get('v'))
  return {
    flightId: params.get('flight'),
    limits: {
      horizontalNm: params.has('h') && Number.isFinite(horizontalNm) ? clamp(horizontalNm, LIMIT_RANGE.horizontalNm) : DEFAULT_LIMITS.horizontalNm,
      verticalFt: params.has('v') && Number.isFinite(verticalFt) ? clamp(verticalFt, LIMIT_RANGE.verticalFt) : DEFAULT_LIMITS.verticalFt,
    },
    analyse: params.get('analyse') === '1',
  }
}

function writeUrl(flightId: string | null, limits: Limits, analysed: boolean): void {
  const params = new URLSearchParams()
  if (flightId) {
    params.set('flight', flightId)
    params.set('h', String(limits.horizontalNm))
    params.set('v', String(limits.verticalFt))
    if (analysed) params.set('analyse', '1')
  }
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export default function App() {
  const [initial] = useState(readUrl)
  const { state, retry } = useFlights()
  const [mapReady, setMapReady] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initial.flightId)
  const [detail, setDetail] = useState<FlightDetail | null>(null)
  const [limits, setLimits] = useState<Limits>(initial.limits)
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle' })
  const [focusedEncounter, setFocusedEncounter] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const autoAnalyse = useRef(initial.analyse)
  const running = useRef<AbortController | null>(null)

  const flights = state.phase === 'ready' ? state.flights : undefined
  const manifest = state.phase === 'ready' || state.phase === 'flights' ? state.manifest : undefined
  const summary = useMemo(() => flights?.find((flight) => flight.flightId === selectedId) ?? null, [flights, selectedId])

  const select = useCallback((flightId: string | null) => {
    running.current?.abort()
    setSelectedId(flightId)
    setDetail(null)
    setDetailError(null)
    setAnalysis({ status: 'idle' })
    setFocusedEncounter(null)
  }, [])

  const analyse = useCallback(
    async (flightId: string, withLimits: Limits) => {
      running.current?.abort()
      const controller = new AbortController()
      running.current = controller
      setAnalysis({ status: 'running' })
      setFocusedEncounter(null)
      try {
        const result = await findNearbyFlights(flightId, withLimits, controller.signal)
        setAnalysis({ status: 'done', result })
      } catch (error) {
        if (controller.signal.aborted) return
        setAnalysis({ status: 'error', message: error instanceof Error ? error.message : 'The analysis failed.' })
      }
    },
    [],
  )

  // Fetch the position reports of the selected flight
  useEffect(() => {
    if (!selectedId || !flights) return
    const controller = new AbortController()
    getFlight(selectedId, controller.signal)
      .then((flight) => {
        setDetail(flight)
        if (autoAnalyse.current) {
          autoAnalyse.current = false
          void analyse(selectedId, limits)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDetailError(error instanceof Error ? error.message : 'The flight could not be loaded.')
      })
    return () => controller.abort()
    // `limits` is deliberately left out: changing a slider must not refetch the flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, flights, analyse])

  const result = analysis.status === 'done' ? analysis.result : null
  const upToDate =
    result !== null && result.limits.horizontalNm === limits.horizontalNm && result.limits.verticalFt === limits.verticalFt

  useEffect(() => {
    if (state.phase === 'ready') writeUrl(selectedId, limits, upToDate)
  }, [state.phase, selectedId, limits, upToDate])

  const encounters = result?.encounters ?? []
  const onReady = useCallback(() => setMapReady(true), [])

  // On a wide screen the results get a panel of their own on the right, so the list of
  // encounters is visible alongside the controls; otherwise they follow on in the main panel.
  // On a phone the main panel becomes a sheet across the bottom.
  const wide = useMediaQuery('(min-width: 1180px)')
  const compact = useMediaQuery('(max-width: 639px)')
  const insets = useMemo(
    () =>
      compact
        ? { left: 0, right: 0, bottom: Math.round(window.innerHeight * COMPACT_PANEL_HEIGHT) }
        : // The right-hand space is reserved even before an analysis, so the map does not shift when results arrive
          { left: PANEL_WIDTH + 16, right: wide ? RESULTS_WIDTH + 16 : 0, bottom: 0 },
    [compact, wide],
  )
  const results = result && (
    <Results
      result={result}
      stale={!upToDate}
      focusedEncounter={focusedEncounter}
      onFocusEncounter={setFocusedEncounter}
      onSelectFlight={select}
    />
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-page">
      {flights && (
        <>
          <MapView
            flights={flights}
            selected={detail}
            encounters={encounters}
            focusedEncounter={focusedEncounter}
            insets={insets}
            onSelect={select}
            onFocusEncounter={setFocusedEncounter}
            onReady={onReady}
          />

          <aside
            className="thin-scroll absolute top-3 left-3 z-20 flex max-h-[calc(100%-24px)] flex-col gap-4 overflow-y-auto rounded-xl border border-hairline bg-panel/95 p-4 shadow-2xl backdrop-blur max-sm:top-auto max-sm:right-3 max-sm:bottom-3 max-sm:max-h-[50%]"
            style={{ width: `min(${PANEL_WIDTH}px, calc(100% - 24px))` }}
          >
            <header>
              <h1 className="text-base font-semibold tracking-tight text-ink">Flight Proximity</h1>
              {manifest && (
                <p className="text-xs text-muted">
                  France · {longDate(manifest.date)} · {count(manifest.positions)} position reports, each a 4D vector in
                  DynamoDB
                </p>
              )}
            </header>

            <SearchBox flights={flights} onSelect={select} />

            {!summary && (
              <div className="rounded-lg border border-dashed border-hairline px-4 py-5 text-sm text-ink-2">
                <p className="font-medium text-ink">Pick a flight to begin</p>
                <p className="mt-1">
                  Search for a callsign, or click any track on the map. Then choose what counts as close and press Analyse to
                  find every aircraft that came near it, in space and in time.
                </p>
                {selectedId && state.phase === 'ready' && (
                  <p className="mt-2 text-muted">Flight {selectedId} is not in this dataset.</p>
                )}
              </div>
            )}

            {summary && (
              <>
                <FlightCard
                  summary={summary}
                  detail={detail}
                  encounters={encounters}
                  focusedEncounter={focusedEncounter}
                  onFocusEncounter={setFocusedEncounter}
                  onClear={() => select(null)}
                />
                {detailError && <p className="text-sm text-ink-2">{detailError}</p>}

                <hr className="border-hairline" />
                <ProximityControls
                  limits={limits}
                  onChange={setLimits}
                  onAnalyse={() => void analyse(summary.flightId, limits)}
                  running={analysis.status === 'running'}
                  upToDate={upToDate}
                />

                {analysis.status === 'error' && (
                  <p role="alert" className="rounded-lg border border-hairline bg-white/[0.04] px-3 py-2 text-sm text-ink-2">
                    <span className="font-medium text-ink">The analysis did not complete.</span> {analysis.message}
                  </p>
                )}

                {results && !wide && (
                  <>
                    <hr className="border-hairline" />
                    {results}
                  </>
                )}
              </>
            )}
          </aside>

          {results && wide && (
            <aside
              className="thin-scroll absolute top-3 right-3 z-20 max-h-[calc(100%-132px)] overflow-y-auto rounded-xl border border-hairline bg-panel/95 p-4 shadow-2xl backdrop-blur"
              style={{ width: RESULTS_WIDTH }}
            >
              {results}
            </aside>
          )}

          <Legend
            flights={flights.length}
            hasSelection={summary !== null}
            hasEncounters={encounters.length > 0}
            left={PANEL_WIDTH + 24}
          />
        </>
      )}

      <LoadingScreen state={state} mapReady={mapReady} onRetry={retry} />
    </div>
  )
}
