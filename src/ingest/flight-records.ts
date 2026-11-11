/**
 * Turns the raw NDJSON flight file into flights ready to be stored.
 *
 * Each line of the file is one flight:
 *
 *   { "callsign": "IBE07TT", "date": "2026-10-01", "icao": "3423C4", ...,
 *     "segments": [ [ [lon, lat, altitudeFt, epochSeconds], ... ], ... ] }
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { encodePolyline } from '../geo/polyline';
import { DEFAULT_SCALES, VectorSpace } from '../geo/vector-space';
import { bucketOf } from '../store/keys';
import type { DatasetManifest, Flight, FlightSummary, Position } from '../store/types';

export interface RawFlightRecord {
  id: string;
  date: string;
  callsign: string | null;
  icao: string;
  registration: string | null;
  aircraftType: string | null;
  startTime: string;
  endTime: string;
  /** [longitude, latitude, altitude in feet, epoch seconds] */
  segments: [number, number, number, number][][];
}

export async function readRawFlights(file: string, limit = Infinity): Promise<RawFlightRecord[]> {
  const records: RawFlightRecord[] = [];
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line) as RawFlightRecord);
    if (records.length >= limit) break;
  }
  lines.close();
  return records;
}

function toPositions(record: RawFlightRecord): Position[] {
  const positions: Position[] = [];
  const seen = new Set<number>();
  record.segments.forEach((segment, seg) => {
    for (const [lon, lat, alt, ts] of segment) {
      // The sort key is the timestamp to the millisecond, so a repeated timestamp would overwrite
      const millis = Math.round(ts * 1000);
      if (seen.has(millis)) continue;
      seen.add(millis);
      positions.push({ lon, lat, alt, ts: millis / 1000, seg });
    }
  });
  return positions.sort((a, b) => a.ts - b.ts);
}

function toTrackPolylines(positions: readonly Position[]): string[] {
  const segments = new Map<number, [number, number][]>();
  for (const { seg, lon, lat } of positions) {
    if (!segments.has(seg)) segments.set(seg, []);
    segments.get(seg)!.push([lon, lat]);
  }
  return [...segments.values()].map(encodePolyline);
}

/**
 * Builds flights from raw records.
 *
 * A flight is identified by `CALLSIGN#DATE`. Around 8% of callsigns appear more
 * than once in a day (an aircraft flying several legs under one callsign, or a
 * shared training callsign), so later flights get a `#2`, `#3`... suffix in
 * order of departure. Aircraft with no callsign are identified by their ICAO
 * 24-bit address instead.
 */
export function toFlights(records: readonly RawFlightRecord[]): Flight[] {
  const ordered = [...records].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  const seen = new Map<string, number>();
  const flights: Flight[] = [];

  for (const record of ordered) {
    const positions = toPositions(record);
    if (positions.length === 0) continue;

    const callsign = record.callsign?.trim() || record.icao;
    const base = `${callsign}#${record.date}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);

    const altitudes = positions.map((position) => position.alt);
    const summary: FlightSummary = {
      flightId: occurrence === 1 ? base : `${base}#${occurrence}`,
      callsign,
      date: record.date,
      icao: record.icao,
      ...(record.registration && { registration: record.registration }),
      ...(record.aircraftType && { aircraftType: record.aircraftType }),
      startTime: new Date(positions[0].ts * 1000).toISOString(),
      endTime: new Date(positions[positions.length - 1].ts * 1000).toISOString(),
      pointCount: positions.length,
      minAlt: Math.min(...altitudes),
      maxAlt: Math.max(...altitudes),
      track: toTrackPolylines(positions),
    };
    flights.push({ summary, positions });
  }
  return flights;
}

/** The vector space for a dataset: time is measured from midnight UTC on the dataset's date */
export function vectorSpaceFor(date: string): VectorSpace {
  return { epochSeconds: Date.parse(`${date}T00:00:00Z`) / 1000, ...DEFAULT_SCALES };
}

export function buildManifest(flights: readonly Flight[], loadedAt = new Date()): DatasetManifest {
  if (flights.length === 0) throw new Error('Cannot build a manifest for an empty dataset');
  const dates = new Set(flights.map((flight) => flight.summary.date));
  if (dates.size !== 1) throw new Error(`Expected flights for a single date, found: ${[...dates].join(', ')}`);
  const [date] = dates;

  const counts = new Map<string, number>();
  for (const { summary } of flights) {
    const bucket = bucketOf(summary.startTime);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return {
    date,
    flights: flights.length,
    positions: flights.reduce((total, flight) => total + flight.positions.length, 0),
    buckets: [...counts.entries()]
      .map(([bucket, count]) => ({ bucket, flights: count }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    version: loadedAt.getTime().toString(36),
    loadedAt: loadedAt.toISOString(),
    vectorSpace: vectorSpaceFor(date),
  };
}
