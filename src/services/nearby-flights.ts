/**
 * Finds the flights that came close to a given flight, in space and time.
 *
 * Two stages, the classic pattern for any approximate index:
 *
 *  1. Recall. For every point along the flight, ask the vector index for the
 *     nearest stored position reports in 4D. All searches run in parallel. Any
 *     other flight with a report inside the candidate radius becomes a candidate.
 *
 *  2. Refine. Position reports arrive about once a minute and are not aligned
 *     between aircraft, so the nearest stored points only tell us that two
 *     flights were in the same neighbourhood. For each candidate we load its
 *     track and compute the exact closest point of approach.
 *
 * The index reduces 14,000 flights to a few dozen. The geometry gives the answer.
 */

import { ClosestApproach, ProximityLimits, closestApproach } from '../geo/closest-approach';
import { TrackPoint, probePoints, toLegs, toTrack } from '../geo/track';
import { FEET_PER_KM, KM_PER_NM, VectorSpace, candidateRadiusKm, toVector, vectorDistance } from '../geo/vector-space';
import { mapWithConcurrency } from '../shared/utils';
import type { FlightStore, FlightSummary } from '../store/types';

export interface NearbyOptions {
  /** How close counts as close, horizontally (nautical miles) */
  horizontalNm: number;
  /** How close counts as close, vertically (feet) */
  verticalFt: number;
  /** Results requested per vector search. DynamoDB allows at most 100. */
  topK?: number;
  /** Maximum spacing between search points along the flight, in seconds */
  probeStepSeconds?: number;
  /** Maximum number of DynamoDB requests in flight at once */
  concurrency?: number;
}

export const NEARBY_DEFAULTS = {
  horizontalNm: 5,
  verticalFt: 1000,
  topK: 100,
  probeStepSeconds: 30,
  concurrency: 48,
};

export const NEARBY_LIMITS = {
  horizontalNm: { min: 0.1, max: 20 },
  verticalFt: { min: 0, max: 5000 },
};

/** Upper bound on searches per request, so one very long flight cannot run away with the Lambda */
const MAX_PROBES = 600;

interface PointOut {
  lon: number;
  lat: number;
  alt: number;
}

export interface Encounter {
  flightId: string;
  callsign: string;
  aircraftType?: string;
  registration?: string;
  /** ISO timestamp of the closest approach */
  time: string;
  horizontalNm: number;
  horizontalKm: number;
  verticalFt: number;
  /** Straight-line distance between the two aircraft, in kilometres */
  slantKm: number;
  /** How long the two aircraft stayed inside both limits */
  secondsWithinLimits: number;
  /** Position of the analysed flight, and of the other flight, at the closest approach */
  own: PointOut;
  other: PointOut;
  /** Nearest 4D distance the vector index found between the two flights, in kilometres of vector space */
  vectorDistanceKm: number;
}

export interface NearbyStats {
  positionReports: number;
  /** Vector searches issued (one per probe point) */
  searches: number;
  /** Stored position reports returned across all searches */
  neighbours: number;
  /** Searches that filled their TopK inside the candidate radius, so may have been cut short */
  saturatedSearches: number;
  /** Distinct other flights with a report inside the candidate radius */
  candidates: number;
  encounters: number;
  candidateRadiusKm: number;
  topK: number;
  searchMs: number;
  refineMs: number;
  totalMs: number;
  /** Bytes billed by the vector index for the searches, when reported */
  vectorSearchBytes?: number;
}

export interface NearbyResult {
  flight: FlightSummary;
  limits: { horizontalNm: number; verticalFt: number };
  encounters: Encounter[];
  stats: NearbyStats;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const pointOut = (point: TrackPoint): PointOut => ({
  lon: round(point.lon, 5),
  lat: round(point.lat, 5),
  alt: Math.round(point.alt),
});

function toEncounter(summary: FlightSummary, approach: ClosestApproach, vectorDistanceKm: number): Encounter {
  return {
    flightId: summary.flightId,
    callsign: summary.callsign,
    aircraftType: summary.aircraftType,
    registration: summary.registration,
    time: new Date(Math.round(approach.ts * 1000)).toISOString(),
    horizontalNm: round(approach.horizontalKm / KM_PER_NM, 2),
    horizontalKm: round(approach.horizontalKm, 2),
    verticalFt: Math.round(approach.verticalFt),
    slantKm: round(Math.hypot(approach.horizontalKm, approach.verticalFt / FEET_PER_KM), 2),
    secondsWithinLimits: Math.round(approach.secondsWithinLimits),
    own: pointOut(approach.own),
    other: pointOut(approach.other),
    vectorDistanceKm: round(vectorDistanceKm, 2),
  };
}

/** Chooses the probe points for a track, widening the step if a flight is long enough to exceed the cap. */
function probesFor(track: readonly TrackPoint[], stepSeconds: number): TrackPoint[] {
  let step = stepSeconds;
  let probes = probePoints(track, step);
  while (probes.length > MAX_PROBES) {
    step *= 2;
    probes = probePoints(track, step);
  }
  return probes;
}

interface Candidate {
  flightId: string;
  /** Smallest 4D distance between any probe and any of this flight's stored reports */
  distanceKm: number;
}

/**
 * Stage 1: one vector search per probe point, in parallel.
 * Distances are recomputed from the returned positions rather than read from the
 * index score, so the candidate radius means exactly what this code says it means.
 */
async function findCandidates(
  store: FlightStore,
  space: VectorSpace,
  ownFlightId: string,
  probes: readonly TrackPoint[],
  radiusKm: number,
  topK: number,
  concurrency: number,
): Promise<{ candidates: Candidate[]; neighbours: number; saturatedSearches: number; consumedBytes?: number }> {
  const best = new Map<string, number>();
  let neighbours = 0;
  let saturatedSearches = 0;
  let consumedBytes: number | undefined;

  await mapWithConcurrency(probes, concurrency, async (probe) => {
    const vector = toVector(space, probe);
    const { hits, consumedBytes: bytes } = await store.searchPositions(vector, topK);
    neighbours += hits.length;
    if (bytes !== undefined) consumedBytes = (consumedBytes ?? 0) + bytes;

    let insideRadius = 0;
    for (const hit of hits) {
      const distanceKm = vectorDistance(vector, toVector(space, hit.position));
      if (distanceKm > radiusKm) continue;
      insideRadius++;
      if (hit.flightId === ownFlightId) continue;
      const previous = best.get(hit.flightId);
      if (previous === undefined || distanceKm < previous) best.set(hit.flightId, distanceKm);
    }
    if (hits.length >= topK && insideRadius === hits.length) saturatedSearches++;
  });

  const candidates = [...best.entries()].map(([flightId, distanceKm]) => ({ flightId, distanceKm }));
  return { candidates, neighbours, saturatedSearches, consumedBytes };
}

export async function findNearbyFlights(
  store: FlightStore,
  flightId: string,
  options: NearbyOptions,
): Promise<NearbyResult | undefined> {
  const started = Date.now();
  const topK = options.topK ?? NEARBY_DEFAULTS.topK;
  const concurrency = options.concurrency ?? NEARBY_DEFAULTS.concurrency;
  const probeStepSeconds = options.probeStepSeconds ?? NEARBY_DEFAULTS.probeStepSeconds;

  const [manifest, flight] = await Promise.all([store.getManifest(), store.getFlight(flightId)]);
  if (!manifest || !flight) return undefined;

  const space = manifest.vectorSpace;
  const limits: ProximityLimits = { horizontalKm: options.horizontalNm * KM_PER_NM, verticalFt: options.verticalFt };
  const radiusKm = candidateRadiusKm(space, limits.horizontalKm, limits.verticalFt);

  const track = toTrack(flight.positions);
  const probes = probesFor(track, probeStepSeconds);

  // Stage 1: recall
  const search = await findCandidates(store, space, flightId, probes, radiusKm, topK, concurrency);
  const searchMs = Date.now() - started;

  // Stage 2: refine
  const refineStarted = Date.now();
  const ownLegs = toLegs(track);
  const refined = await mapWithConcurrency(search.candidates, concurrency, async (candidate) => {
    const other = await store.getFlight(candidate.flightId);
    if (!other) return undefined;
    const approach = closestApproach(ownLegs, toLegs(toTrack(other.positions)), limits);
    if (!approach || approach.horizontalKm > limits.horizontalKm) return undefined;
    return toEncounter(other.summary, approach, candidate.distanceKm);
  });
  const encounters = refined
    .filter((encounter): encounter is Encounter => encounter !== undefined)
    .sort((a, b) => a.horizontalKm - b.horizontalKm || a.verticalFt - b.verticalFt);
  const refineMs = Date.now() - refineStarted;

  return {
    flight: flight.summary,
    limits: { horizontalNm: options.horizontalNm, verticalFt: options.verticalFt },
    encounters,
    stats: {
      positionReports: flight.positions.length,
      searches: probes.length,
      neighbours: search.neighbours,
      saturatedSearches: search.saturatedSearches,
      candidates: search.candidates.length,
      encounters: encounters.length,
      candidateRadiusKm: round(radiusKm, 1),
      topK,
      searchMs,
      refineMs,
      totalMs: Date.now() - started,
      ...(search.consumedBytes !== undefined && { vectorSearchBytes: Math.round(search.consumedBytes) }),
    },
  };
}
