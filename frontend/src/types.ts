// Shapes returned by the flights API. They mirror src/store/types.ts and
// src/services/nearby-flights.ts in the backend.

export interface FlightSummary {
  /** `CALLSIGN#DATE`, with `#2`, `#3`... when a callsign is reused on the same day */
  flightId: string
  callsign: string
  date: string
  icao: string
  registration?: string
  aircraftType?: string
  startTime: string
  endTime: string
  pointCount: number
  minAlt: number
  maxAlt: number
  /** One encoded polyline per continuous segment of the track */
  track: string[]
}

export interface Position {
  lon: number
  lat: number
  /** Altitude in feet */
  alt: number
  /** Epoch seconds */
  ts: number
  seg: number
  /** The 4D vector this report is indexed under: [x km, y km, scaled altitude, scaled time] */
  vec: [number, number, number, number]
}

export interface FlightDetail extends FlightSummary {
  positions: Position[]
}

export interface Manifest {
  date: string
  flights: number
  positions: number
  buckets: { bucket: string; flights: number }[]
  version: string
  loadedAt: string
  vectorSpace: { epochSeconds: number; kmPerFoot: number; kmPerSecond: number }
}

export interface PointAt {
  lon: number
  lat: number
  alt: number
}

export interface Encounter {
  flightId: string
  callsign: string
  aircraftType?: string
  registration?: string
  /** ISO timestamp of the closest approach */
  time: string
  horizontalNm: number
  horizontalKm: number
  verticalFt: number
  slantKm: number
  secondsWithinLimits: number
  own: PointAt
  other: PointAt
  vectorDistanceKm: number
}

export interface NearbyStats {
  positionReports: number
  searches: number
  neighbours: number
  saturatedSearches: number
  candidates: number
  encounters: number
  candidateRadiusKm: number
  topK: number
  searchMs: number
  refineMs: number
  totalMs: number
  vectorSearchBytes?: number
}

export interface NearbyResult {
  flight: FlightSummary
  limits: Limits
  encounters: Encounter[]
  stats: NearbyStats
}

export interface Limits {
  horizontalNm: number
  verticalFt: number
}

/** A flight prepared for the map: decoded track plus lookup fields */
export interface MapFlight extends FlightSummary {
  /** Decoded track, one array of [lon, lat] per segment */
  lines: [number, number][][]
  /** Seconds since midnight UTC */
  startSeconds: number
  endSeconds: number
}
