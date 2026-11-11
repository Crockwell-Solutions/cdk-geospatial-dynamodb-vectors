import type { FlightDetail, FlightSummary, Limits, Manifest, NearbyResult } from '../types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'The flights API could not be reached.')
  }
  if (!response.ok) {
    let message = `The flights API returned ${response.status}.`
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // Not JSON; keep the generic message
    }
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}

export const getManifest = (signal?: AbortSignal): Promise<Manifest> => get('/api/manifest', signal)

/** The version is only there to give each dataset load its own cache entry */
export const listFlights = (bucket: string, version: string, signal?: AbortSignal): Promise<{ flights: FlightSummary[] }> =>
  get(`/api/flights?bucket=${bucket}&v=${encodeURIComponent(version)}`, signal)

export const getFlight = (flightId: string, signal?: AbortSignal): Promise<FlightDetail> =>
  get(`/api/flights/${encodeURIComponent(flightId)}`, signal)

export const findNearbyFlights = (flightId: string, limits: Limits, signal?: AbortSignal): Promise<NearbyResult> =>
  get(
    `/api/flights/${encodeURIComponent(flightId)}/nearby?horizontalNm=${limits.horizontalNm}&verticalFt=${limits.verticalFt}`,
    signal,
  )
