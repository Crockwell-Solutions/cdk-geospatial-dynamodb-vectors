/**
 * Brute-force reference answer for "which flights came close to this one?".
 *
 * Compares a flight against every other flight in the dataset using the exact
 * closest-approach calculation, with no index involved. Slow, simple and
 * obviously correct: the yardstick that the vector search is measured against,
 * both in the test suite and in `npm run evaluate`.
 */

import { ClosestApproach, ProximityLimits, closestApproach } from '../src/geo/closest-approach';
import { Leg, toLegs, toTrack } from '../src/geo/track';
import { KM_PER_NM } from '../src/geo/vector-space';
import type { Flight } from '../src/store/types';

export interface IndexedFlight {
  flight: Flight;
  legs: Leg[];
  startTs: number;
  endTs: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function indexFlights(flights: readonly Flight[]): IndexedFlight[] {
  return flights.map((flight) => {
    const track = toTrack(flight.positions);
    const xs = track.map((point) => point.x);
    const ys = track.map((point) => point.y);
    return {
      flight,
      legs: toLegs(track),
      startTs: track[0].ts,
      endTs: track[track.length - 1].ts,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });
}

export interface TrueEncounter {
  flightId: string;
  approach: ClosestApproach;
}

export function trueEncounters(
  subject: IndexedFlight,
  everything: readonly IndexedFlight[],
  horizontalNm: number,
  verticalFt: number,
): TrueEncounter[] {
  const limits: ProximityLimits = { horizontalKm: horizontalNm * KM_PER_NM, verticalFt };
  const reach = limits.horizontalKm;
  const encounters: TrueEncounter[] = [];

  for (const other of everything) {
    if (other === subject) continue;
    // Cheap rejections first: no overlap in time, or bounding boxes further apart than the limit
    if (other.endTs < subject.startTs || other.startTs > subject.endTs) continue;
    if (other.minX > subject.maxX + reach || other.maxX < subject.minX - reach) continue;
    if (other.minY > subject.maxY + reach || other.maxY < subject.minY - reach) continue;

    const approach = closestApproach(subject.legs, other.legs, limits);
    if (approach && approach.horizontalKm <= limits.horizontalKm) {
      encounters.push({ flightId: other.flight.summary.flightId, approach });
    }
  }
  return encounters;
}

/** Deterministic pseudo-random numbers, so samples are the same on every run */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function sample<T>(items: readonly T[], count: number, seed: number): T[] {
  const random = seededRandom(seed);
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}
