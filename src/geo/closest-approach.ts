/**
 * Exact closest point of approach between two flight tracks.
 *
 * The vector index tells us which flights are worth looking at. This module
 * then answers the precise question: at the same instant, how close did the
 * two aircraft actually get?
 *
 * Both tracks are piecewise linear in time. Wherever a leg of one overlaps a
 * leg of the other, the relative position is a straight line in time, so the
 * horizontal distance squared is a quadratic and its minimum has a closed
 * form. No sampling, no time step.
 */

import { Leg, TrackPoint, positionOnLeg } from './track';

export interface ProximityLimits {
  /** Maximum horizontal distance to count as "close", in kilometres */
  horizontalKm: number;
  /** Maximum altitude difference to count as "close", in feet */
  verticalFt: number;
}

export interface ClosestApproach {
  /** Epoch seconds of the closest approach */
  ts: number;
  /** Horizontal distance between the aircraft at that instant, in kilometres */
  horizontalKm: number;
  /** Altitude difference at that instant, in feet (always positive) */
  verticalFt: number;
  /** Where the flight being analysed was */
  own: TrackPoint;
  /** Where the other flight was */
  other: TrackPoint;
  /** Total time the two aircraft spent inside both limits, in seconds */
  secondsWithinLimits: number;
}

interface Window {
  start: number;
  end: number;
}

const EMPTY: Window = { start: 0, end: -1 };

const velocity = (from: number, to: number, duration: number): number => (duration > 0 ? (to - from) / duration : 0);

/** The part of [0, duration] during which |offset + rate * u| <= limit */
function windowWithin(offset: number, rate: number, limit: number, duration: number): Window {
  if (Math.abs(rate) < 1e-12) {
    return Math.abs(offset) <= limit ? { start: 0, end: duration } : EMPTY;
  }
  const a = (-limit - offset) / rate;
  const b = (limit - offset) / rate;
  return { start: Math.max(0, Math.min(a, b)), end: Math.min(duration, Math.max(a, b)) };
}

/** Length of the part of `window` during which |p + v * u| <= radius (a quadratic inequality in u) */
function secondsInsideRadius(px: number, py: number, vx: number, vy: number, radius: number, window: Window): number {
  const a = vx * vx + vy * vy;
  const c = px * px + py * py - radius * radius;
  if (a < 1e-18) {
    return c <= 0 ? window.end - window.start : 0;
  }
  const halfB = px * vx + py * vy;
  const discriminant = halfB * halfB - a * c;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  const start = Math.max(window.start, (-halfB - root) / a);
  const end = Math.min(window.end, (-halfB + root) / a);
  return Math.max(0, end - start);
}

/**
 * Finds the instant at which two aircraft were horizontally closest while
 * their altitudes were within `limits.verticalFt` of each other.
 *
 * Returns undefined if the tracks never overlap in time, or if the aircraft
 * were never within the vertical limit. The caller decides whether the
 * horizontal distance found is close enough.
 */
export function closestApproach(
  own: readonly Leg[],
  other: readonly Leg[],
  limits: ProximityLimits,
): ClosestApproach | undefined {
  let best: { horizontalKm: number; ts: number; ownLeg: Leg; otherLeg: Leg } | undefined;
  let secondsWithinLimits = 0;
  let i = 0;
  let j = 0;

  while (i < own.length && j < other.length) {
    const a = own[i];
    const b = other[j];
    const start = Math.max(a.from.ts, b.from.ts);
    const end = Math.min(a.to.ts, b.to.ts);

    if (start <= end) {
      const duration = end - start;
      const a0 = positionOnLeg(a, start);
      const b0 = positionOnLeg(b, start);
      const aDuration = a.to.ts - a.from.ts;
      const bDuration = b.to.ts - b.from.ts;

      // Position and velocity of the other aircraft relative to our own
      const px = b0.x - a0.x;
      const py = b0.y - a0.y;
      const pz = b0.alt - a0.alt;
      const vx = velocity(b.from.x, b.to.x, bDuration) - velocity(a.from.x, a.to.x, aDuration);
      const vy = velocity(b.from.y, b.to.y, bDuration) - velocity(a.from.y, a.to.y, aDuration);
      const vz = velocity(b.from.alt, b.to.alt, bDuration) - velocity(a.from.alt, a.to.alt, aDuration);

      const vertical = windowWithin(pz, vz, limits.verticalFt, duration);
      if (vertical.start <= vertical.end) {
        const speedSquared = vx * vx + vy * vy;
        const unconstrained = speedSquared > 0 ? -(px * vx + py * vy) / speedSquared : vertical.start;
        const u = Math.min(vertical.end, Math.max(vertical.start, unconstrained));
        const horizontalKm = Math.hypot(px + vx * u, py + vy * u);
        if (!best || horizontalKm < best.horizontalKm) {
          best = { horizontalKm, ts: start + u, ownLeg: a, otherLeg: b };
        }
        secondsWithinLimits += secondsInsideRadius(px, py, vx, vy, limits.horizontalKm, vertical);
      }
    }

    // Move on from whichever leg finishes first
    if (a.to.ts < b.to.ts) i++;
    else j++;
  }

  if (!best) return undefined;

  const ownPosition = positionOnLeg(best.ownLeg, best.ts);
  const otherPosition = positionOnLeg(best.otherLeg, best.ts);
  return {
    ts: best.ts,
    horizontalKm: best.horizontalKm,
    verticalFt: Math.abs(otherPosition.alt - ownPosition.alt),
    own: ownPosition,
    other: otherPosition,
    secondsWithinLimits,
  };
}
