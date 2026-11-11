/**
 * The 4D vector space used by the DynamoDB vector index.
 *
 * Every position report becomes four numbers, all expressed in kilometres:
 *
 *   [ x, y, z, t ]
 *     x, y  kilometres east / north on the Lambert-93 grid
 *     z     altitude, stretched so that 1,000 ft counts the same as 5 NM
 *     t     time, stretched so that one second counts as 250 m
 *
 * A Euclidean vector index treats every dimension equally, so the scaling is
 * where the domain knowledge lives. It decides what "near" means:
 *
 *  - Altitude: aircraft are routinely 1,000 ft above one another, yet rarely
 *    within 5 NM at the same level. Those are the standard en-route separation
 *    minima, so we make them the same length in vector space. Without the
 *    stretch, an aircraft 1,000 ft (0.3 km) directly overhead would look far
 *    closer than one 2 NM (3.7 km) away at the same level.
 *
 *  - Time: a jet covers about 250 m every second. Using that as the exchange
 *    rate means "the same place a minute later" is as far away as "15 km away
 *    right now", which is how far apart the two aircraft really were.
 *
 * The scales are baked into every stored vector, so they are saved with the
 * dataset manifest and read back at query time. Query vectors must be built
 * with exactly the same numbers.
 */

import { projectToKm } from './projection';

export const VECTOR_DIMENSIONS = 4;
export const KM_PER_NM = 1.852;
export const FEET_PER_KM = 3280.8399;

export type Vector4 = [x: number, y: number, z: number, t: number];

export interface VectorSpace {
  /** Epoch seconds that map to t = 0 (midnight UTC at the start of the dataset) */
  epochSeconds: number;
  /** Kilometres of vector distance per foot of altitude */
  kmPerFoot: number;
  /** Kilometres of vector distance per second of time */
  kmPerSecond: number;
}

export const DEFAULT_SCALES = {
  /** 5 NM of lateral distance is equivalent to 1,000 ft of altitude */
  kmPerFoot: (5 * KM_PER_NM) / 1000,
  /** One second is equivalent to 250 m, about the distance a jet covers in that time */
  kmPerSecond: 0.25,
};

export interface FourDPoint {
  lon: number;
  lat: number;
  /** Altitude in feet */
  alt: number;
  /** Epoch seconds */
  ts: number;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Encodes a position report as a 4D vector. Rounded to the metre: more than a 32-bit float can hold anyway. */
export function toVector(space: VectorSpace, point: FourDPoint): Vector4 {
  const { x, y } = projectToKm(point.lon, point.lat);
  return [
    round3(x),
    round3(y),
    round3(point.alt * space.kmPerFoot),
    round3((point.ts - space.epochSeconds) * space.kmPerSecond),
  ];
}

export function vectorDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Extra radius added to every search to allow for sparse position reports.
 *
 * Reports arrive roughly once a minute and are not aligned between aircraft, so
 * the stored point nearest to a true closest approach can be several kilometres
 * off in both space and time. 15 km gave 100% recall of real encounters on the
 * sample data (see scripts/evaluate-recall.ts).
 */
export const SAMPLING_SLACK_KM = 15;

/**
 * How far away, in vector space, a stored position can be and still belong to a
 * flight that might have come within the given limits. Anything beyond this is
 * ignored without further work.
 */
export function candidateRadiusKm(space: VectorSpace, horizontalKm: number, verticalFt: number): number {
  return Math.hypot(horizontalKm, verticalFt * space.kmPerFoot) + SAMPLING_SLACK_KM;
}
