/**
 * Domain types shared by the loader, the API and the stores.
 */

import type { Position } from '../geo/track';
import type { Vector4, VectorSpace } from '../geo/vector-space';

export type { Position };

/** Everything needed to list a flight and draw it on the map, without its individual position reports */
export interface FlightSummary {
  /** `CALLSIGN#DATE`, with `#2`, `#3`... appended when a callsign is reused on the same day */
  flightId: string;
  callsign: string;
  /** UTC date of the flight, YYYY-MM-DD */
  date: string;
  /** ICAO 24-bit aircraft address (hex) */
  icao: string;
  registration?: string;
  aircraftType?: string;
  /** ISO timestamps of the first and last position report */
  startTime: string;
  endTime: string;
  pointCount: number;
  /** Lowest and highest reported altitude, in feet */
  minAlt: number;
  maxAlt: number;
  /** One encoded polyline per continuous segment of the track */
  track: string[];
}

export interface Flight {
  summary: FlightSummary;
  positions: Position[];
}

export interface DatasetBucket {
  /** Hour of day (UTC) in which the flights in this bucket start, "00" to "23" */
  bucket: string;
  flights: number;
}

/** Describes what has been loaded, and how its vectors were encoded */
export interface DatasetManifest {
  date: string;
  flights: number;
  positions: number;
  buckets: DatasetBucket[];
  /** Changes every time the data is reloaded; the browser uses it as a cache key */
  version: string;
  loadedAt: string;
  vectorSpace: VectorSpace;
}

/** A stored position report returned by a vector search */
export interface VectorHit {
  flightId: string;
  position: Pick<Position, 'lon' | 'lat' | 'alt' | 'ts'>;
  /** Distance reported by the index (Euclidean, so lower is closer) */
  score: number;
}

export interface VectorSearchResult {
  hits: VectorHit[];
  /** Bytes billed for the search, when the store reports it */
  consumedBytes?: number;
}

export interface FlightStore {
  getManifest(): Promise<DatasetManifest | undefined>;
  /** Flight summaries for one hour-of-day bucket */
  listFlights(date: string, bucket: string): Promise<FlightSummary[]>;
  getFlight(flightId: string): Promise<Flight | undefined>;
  /** Position reports only; empty when the flight does not exist */
  getPositions(flightId: string): Promise<Position[]>;
  /** The `topK` stored position reports nearest to `vector`, nearest first */
  searchPositions(vector: Vector4, topK: number): Promise<VectorSearchResult>;
}
