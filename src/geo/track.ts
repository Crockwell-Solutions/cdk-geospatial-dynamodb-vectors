/**
 * Flight tracks as piecewise-linear paths through space and time.
 *
 * A track is a list of position reports. Between two consecutive reports in the
 * same segment we assume the aircraft flew in a straight line at constant speed
 * and constant climb rate: a "leg". Reports in different segments are separated
 * by a gap in coverage and are never joined up.
 */

import { projectToKm } from './projection';

export interface Position {
  lon: number;
  lat: number;
  /** Altitude in feet */
  alt: number;
  /** Epoch seconds */
  ts: number;
  /** Index of the continuous segment this report belongs to */
  seg: number;
}

/** A position with its projected grid coordinates in kilometres */
export interface TrackPoint extends Position {
  x: number;
  y: number;
}

export interface Leg {
  from: TrackPoint;
  to: TrackPoint;
}

export function toTrackPoint(position: Position): TrackPoint {
  const { x, y } = projectToKm(position.lon, position.lat);
  return { ...position, x, y };
}

/** Projects every report and returns them in time order. */
export function toTrack(positions: readonly Position[]): TrackPoint[] {
  return positions.map(toTrackPoint).sort((a, b) => a.ts - b.ts);
}

/**
 * Splits a track into legs. A segment containing a single report becomes a
 * zero-length leg so that it can still be compared at that one instant.
 */
export function toLegs(track: readonly TrackPoint[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < track.length; i++) {
    const from = track[i];
    const to = track[i + 1];
    if (to && to.seg === from.seg) {
      legs.push({ from, to });
    } else if (i === 0 || track[i - 1].seg !== from.seg) {
      legs.push({ from, to: from });
    }
  }
  return legs;
}

const lerp = (a: number, b: number, fraction: number): number => a + (b - a) * fraction;

/** Position along a leg at the given time, clamped to the ends of the leg. */
export function positionOnLeg(leg: Leg, ts: number): TrackPoint {
  const duration = leg.to.ts - leg.from.ts;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, (ts - leg.from.ts) / duration)) : 0;
  return {
    lon: lerp(leg.from.lon, leg.to.lon, fraction),
    lat: lerp(leg.from.lat, leg.to.lat, fraction),
    alt: lerp(leg.from.alt, leg.to.alt, fraction),
    x: lerp(leg.from.x, leg.to.x, fraction),
    y: lerp(leg.from.y, leg.to.y, fraction),
    ts: lerp(leg.from.ts, leg.to.ts, fraction),
    seg: leg.from.seg,
  };
}

/**
 * The points to search from: every position report, plus interpolated points so
 * that there is never more than `maxStepSeconds` between consecutive probes.
 *
 * The denser the probes, the closer one of them lands in time to another
 * aircraft's stored report, and the more searches we run.
 */
export function probePoints(track: readonly TrackPoint[], maxStepSeconds: number): TrackPoint[] {
  const probes: TrackPoint[] = [];
  for (let i = 0; i < track.length; i++) {
    const from = track[i];
    probes.push(from);
    const to = track[i + 1];
    if (!to || to.seg !== from.seg || maxStepSeconds <= 0) continue;
    const steps = Math.ceil((to.ts - from.ts) / maxStepSeconds);
    for (let step = 1; step < steps; step++) {
      probes.push(positionOnLeg({ from, to }, lerp(from.ts, to.ts, step / steps)));
    }
  }
  return probes;
}
