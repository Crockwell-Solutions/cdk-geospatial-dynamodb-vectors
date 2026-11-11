/**
 * Synthetic flights for tests. Tracks are described on the flat Lambert-93 grid
 * (kilometres from the centre of France), which keeps the geometry in each test
 * easy to reason about, and converted back to longitude/latitude for storage.
 */

import { buildManifest } from '../src/ingest/flight-records';
import { encodePolyline } from '../src/geo/polyline';
import { unprojectFromKm } from '../src/geo/projection';
import { MemoryFlightStore } from '../src/store/memory-flight-store';
import type { Flight, Position } from '../src/store/types';

export const DATE = '2026-10-01';
export const MIDNIGHT = Date.parse(`${DATE}T00:00:00Z`) / 1000;
export const NOON = MIDNIGHT + 12 * 3600;

export const lonLatAt = unprojectFromKm;

export interface Waypoint {
  /** Kilometres east / north of the grid origin */
  x: number;
  y: number;
  /** Altitude in feet */
  alt: number;
  /** Seconds after noon */
  t: number;
  seg?: number;
}

export function flight(callsign: string, waypoints: Waypoint[], suffix = ''): Flight {
  const positions: Position[] = waypoints.map(({ x, y, alt, t, seg }) => ({
    ...lonLatAt(x, y),
    alt,
    ts: NOON + t,
    seg: seg ?? 0,
  }));
  const altitudes = positions.map((position) => position.alt);
  return {
    summary: {
      flightId: `${callsign}#${DATE}${suffix}`,
      callsign,
      date: DATE,
      icao: 'ABC123',
      aircraftType: 'A320',
      startTime: new Date(positions[0].ts * 1000).toISOString(),
      endTime: new Date(positions[positions.length - 1].ts * 1000).toISOString(),
      pointCount: positions.length,
      minAlt: Math.min(...altitudes),
      maxAlt: Math.max(...altitudes),
      track: [encodePolyline(positions.map(({ lon, lat }) => [lon, lat]))],
    },
    positions,
  };
}

/** A straight, level track reported every `interval` seconds */
export function straight(
  callsign: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  alt: number,
  startT: number,
  endT: number,
  interval = 60,
): Flight {
  const waypoints: Waypoint[] = [];
  for (let t = startT; t <= endT; t += interval) {
    const fraction = (t - startT) / (endT - startT);
    waypoints.push({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, alt, t });
  }
  return flight(callsign, waypoints);
}

export const storeOf = (...flights: Flight[]): MemoryFlightStore =>
  new MemoryFlightStore(buildManifest(flights, new Date('2026-10-02T00:00:00Z')), flights);
