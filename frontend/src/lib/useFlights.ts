import { useCallback, useEffect, useState } from 'react'
import type { FlightSummary, Manifest, MapFlight } from '../types'
import { ApiError, getManifest, listFlights } from './api'
import { readCachedFlights, writeCachedFlights } from './cache'
import { decodePolyline } from './polyline'

export type LoadState =
  | { phase: 'manifest' }
  | { phase: 'flights'; manifest: Manifest; loaded: number; total: number; fromCache: boolean }
  | { phase: 'ready'; manifest: Manifest; flights: MapFlight[]; fromCache: boolean }
  | { phase: 'error'; message: string; notLoaded: boolean }

/** Requests in flight at once while fetching the hourly buckets */
const PARALLEL_REQUESTS = 6

function prepare(flights: FlightSummary[], epochSeconds: number): MapFlight[] {
  return flights
    .map((flight) => ({
      ...flight,
      lines: flight.track.map(decodePolyline),
      startSeconds: Date.parse(flight.startTime) / 1000 - epochSeconds,
      endSeconds: Date.parse(flight.endTime) / 1000 - epochSeconds,
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds)
}

/**
 * Loads every flight for the map.
 *
 * The manifest (tiny, always fetched) says which dataset version is live. If the
 * browser already holds that version in IndexedDB the flights come from there;
 * otherwise the 24 hourly buckets are fetched a few at a time, reporting progress.
 */
export function useFlights(): { state: LoadState; retry: () => void } {
  const [state, setState] = useState<LoadState>({ phase: 'manifest' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    const load = async (): Promise<void> => {
      setState({ phase: 'manifest' })
      const manifest = await getManifest(signal)

      const cached = await readCachedFlights(manifest.version)
      if (signal.aborted) return
      if (cached) {
        setState({ phase: 'flights', manifest, loaded: manifest.flights, total: manifest.flights, fromCache: true })
        setState({ phase: 'ready', manifest, flights: prepare(cached, manifest.vectorSpace.epochSeconds), fromCache: true })
        return
      }

      const flights: FlightSummary[] = []
      const queue = [...manifest.buckets]
      setState({ phase: 'flights', manifest, loaded: 0, total: manifest.flights, fromCache: false })

      const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const page = await listFlights(next.bucket, manifest.version, signal)
          flights.push(...page.flights)
          setState({ phase: 'flights', manifest, loaded: flights.length, total: manifest.flights, fromCache: false })
        }
      }
      await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker))
      if (signal.aborted) return

      void writeCachedFlights(manifest.version, flights)
      setState({ phase: 'ready', manifest, flights: prepare(flights, manifest.vectorSpace.epochSeconds), fromCache: false })
    }

    load().catch((error: unknown) => {
      if (signal.aborted) return
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong loading the flights.',
        notLoaded: error instanceof ApiError && error.status === 404,
      })
    })

    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}
