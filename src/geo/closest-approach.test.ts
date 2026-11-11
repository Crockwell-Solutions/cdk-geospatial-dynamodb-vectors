import { Waypoint, flight, straight } from '../../test/fixtures';
import type { Flight } from '../store/types';
import { closestApproach } from './closest-approach';
import { toLegs, toTrack } from './track';

const legs = (subject: Flight) => toLegs(toTrack(subject.positions));
const LIMITS = { horizontalKm: 10, verticalFt: 1000 };

describe('closest point of approach', () => {
  test('finds a crossing that happens between position reports', () => {
    // Eastbound and northbound at 0.2 km/s, both through the origin at t=330, reported once a minute.
    // No pair of reports is closer than 8 km, but the aircraft actually pass straight over each other.
    const eastbound = straight('EAST', { x: -66, y: 0 }, { x: 54, y: 0 }, 35000, 0, 600);
    const northbound = straight('NORTH', { x: 0, y: -66 }, { x: 0, y: 54 }, 35000, 0, 600);

    const approach = closestApproach(legs(eastbound), legs(northbound), LIMITS)!;
    expect(approach.horizontalKm).toBeLessThan(0.01);
    expect(approach.ts - eastbound.positions[0].ts).toBeCloseTo(330, 0);
    expect(approach.verticalFt).toBeCloseTo(0, 6);
  });

  test('measures the miss distance of a head-on pass on parallel tracks', () => {
    const eastbound = straight('EAST', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 0, 600);
    const westbound = straight('WEST', { x: 60, y: 4 }, { x: -60, y: 4 }, 35000, 0, 600);

    const approach = closestApproach(legs(eastbound), legs(westbound), LIMITS)!;
    expect(approach.horizontalKm).toBeCloseTo(4, 1);
    expect(approach.ts - eastbound.positions[0].ts).toBeCloseTo(300, 0);
    // Closing at 0.4 km/s, they are within 10 km for 2 * sqrt(10^2 - 4^2) / 0.4 seconds
    expect(approach.secondsWithinLimits).toBeCloseTo((2 * Math.sqrt(100 - 16)) / 0.4, 0);
  });

  test('reports the vertical separation at the closest approach', () => {
    const lower = straight('LOW', { x: -60, y: 0 }, { x: 60, y: 0 }, 34000, 0, 600);
    const upper = straight('HIGH', { x: 0, y: -60 }, { x: 0, y: 60 }, 35000, 0, 600);

    const approach = closestApproach(legs(lower), legs(upper), LIMITS)!;
    expect(approach.horizontalKm).toBeLessThan(0.01);
    expect(approach.verticalFt).toBeCloseTo(1000, 6);
    expect(approach.own.alt).toBeCloseTo(34000, 6);
    expect(approach.other.alt).toBeCloseTo(35000, 6);
  });

  test('ignores aircraft that are never within the vertical limit', () => {
    const lower = straight('LOW', { x: -60, y: 0 }, { x: 60, y: 0 }, 31000, 0, 600);
    const upper = straight('HIGH', { x: 0, y: -60 }, { x: 0, y: 60 }, 35000, 0, 600);
    expect(closestApproach(legs(lower), legs(upper), LIMITS)).toBeUndefined();
  });

  test('only considers the part of a climb that is inside the vertical limit', () => {
    // LEVEL flies east at 35,000 ft. CLIMBER follows the same path, climbing from 30,000 to 40,000 ft
    // at 1,000 ft/min, but offset 3 km north. It is within 1,000 ft only between t=240 and t=360.
    const level = straight('LEVEL', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 0, 600);
    const climbing: Waypoint[] = [];
    for (let t = 0; t <= 600; t += 60) climbing.push({ x: -60 + 0.2 * t, y: 3, alt: 30000 + (1000 * t) / 60, t });
    const climber = flight('CLIMBER', climbing);

    const approach = closestApproach(legs(level), legs(climber), LIMITS)!;
    expect(approach.horizontalKm).toBeCloseTo(3, 1);
    expect(approach.verticalFt).toBeLessThanOrEqual(1000 + 1e-6);
    expect(approach.secondsWithinLimits).toBeCloseTo(120, 0);
  });

  test('returns undefined when the flights do not overlap in time', () => {
    const morning = straight('EARLY', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 0, 600);
    const evening = straight('LATE', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 3600, 4200);
    expect(closestApproach(legs(morning), legs(evening), LIMITS)).toBeUndefined();
  });

  test('does not interpolate across a gap between segments', () => {
    const passing = straight('PASSING', { x: 0, y: -60 }, { x: 0, y: 60 }, 35000, 0, 600);
    // Crosses the origin at t=300, exactly when PASSING does, but coverage is lost from t=240 to t=360
    const gappy = flight('GAPPY', [
      { x: -60, y: 0, alt: 35000, t: 0, seg: 0 },
      { x: -12, y: 0, alt: 35000, t: 240, seg: 0 },
      { x: 12, y: 0, alt: 35000, t: 360, seg: 1 },
      { x: 60, y: 0, alt: 35000, t: 600, seg: 1 },
    ]);

    const approach = closestApproach(legs(passing), legs(gappy), LIMITS)!;
    // The closest moments we can vouch for are either side of the gap, about 17 km apart
    expect(approach.horizontalKm).toBeGreaterThan(15);
  });

  test('compares a single position report at its one instant', () => {
    const passing = straight('PASSING', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 0, 600);
    const blip = flight('BLIP', [{ x: 2, y: 5, alt: 35500, t: 300 }]);

    const approach = closestApproach(legs(passing), legs(blip), LIMITS)!;
    expect(approach.horizontalKm).toBeCloseTo(Math.hypot(2, 5), 1);
    expect(approach.verticalFt).toBeCloseTo(500, 6);
    expect(approach.secondsWithinLimits).toBe(0);
  });
});
