import { flight, straight, storeOf } from '../../test/fixtures';
import { KM_PER_NM } from '../geo/vector-space';
import { findNearbyFlights } from './nearby-flights';

// Subject: eastbound through the origin at t=330 at FL350, reported once a minute
const subject = straight('SUBJECT', { x: -66, y: 0 }, { x: 54, y: 0 }, 35000, 0, 600);

describe('finding nearby flights', () => {
  test('finds a crossing flight even though no two position reports are close', async () => {
    const crossing = straight('CROSSER', { x: 0, y: -66 }, { x: 0, y: 54 }, 35000, 0, 600);
    const store = storeOf(subject, crossing);

    const result = (await findNearbyFlights(store, subject.summary.flightId, { horizontalNm: 3, verticalFt: 1000 }))!;

    expect(result.encounters).toHaveLength(1);
    const [encounter] = result.encounters;
    expect(encounter.flightId).toBe(crossing.summary.flightId);
    expect(encounter.callsign).toBe('CROSSER');
    expect(encounter.horizontalNm).toBeLessThan(0.05);
    expect(encounter.verticalFt).toBe(0);
    expect(encounter.time).toBe(new Date((subject.positions[0].ts + 330) * 1000).toISOString());
  });

  test('never reports the flight being analysed', async () => {
    const result = (await findNearbyFlights(storeOf(subject), subject.summary.flightId, {
      horizontalNm: 20,
      verticalFt: 5000,
    }))!;
    expect(result.encounters).toEqual([]);
    expect(result.stats.candidates).toBe(0);
    expect(result.stats.neighbours).toBeGreaterThan(0); // its own reports come back from every search
  });

  test('applies the horizontal and vertical limits', async () => {
    const twoNmNorth = straight('PARALLEL', { x: -66, y: 2 * KM_PER_NM }, { x: 54, y: 2 * KM_PER_NM }, 35000, 0, 600);
    const overhead = straight('OVERHEAD', { x: -66, y: 0 }, { x: 54, y: 0 }, 37000, 0, 600);
    const store = storeOf(subject, twoNmNorth, overhead);
    const analyse = (horizontalNm: number, verticalFt: number) =>
      findNearbyFlights(store, subject.summary.flightId, { horizontalNm, verticalFt });

    expect((await analyse(1, 1000))!.encounters).toEqual([]);
    expect((await analyse(3, 1000))!.encounters.map(({ callsign }) => callsign)).toEqual(['PARALLEL']);
    expect((await analyse(3, 2500))!.encounters.map(({ callsign }) => callsign)).toEqual(['OVERHEAD', 'PARALLEL']);
  });

  test('ignores a flight that passes through the same place at a different time', async () => {
    // Same route, same level, ten minutes behind: 120 km in trail
    const follower = straight('FOLLOWER', { x: -66, y: 0 }, { x: 54, y: 0 }, 35000, 600, 1200);
    const store = storeOf(subject, follower);

    const result = (await findNearbyFlights(store, subject.summary.flightId, { horizontalNm: 10, verticalFt: 1000 }))!;
    expect(result.encounters).toEqual([]);
  });

  test('orders encounters from closest to furthest and reports how long they lasted', async () => {
    const near = straight('NEAR', { x: -66, y: 3 }, { x: 54, y: 3 }, 35000, 0, 600);
    const far = straight('FAR', { x: -66, y: -8 }, { x: 54, y: -8 }, 35000, 0, 600);
    const store = storeOf(subject, far, near);

    const result = (await findNearbyFlights(store, subject.summary.flightId, { horizontalNm: 5, verticalFt: 1000 }))!;
    expect(result.encounters.map(({ callsign }) => callsign)).toEqual(['NEAR', 'FAR']);
    expect(result.encounters[0].horizontalKm).toBeCloseTo(3, 1);
    expect(result.encounters[0].secondsWithinLimits).toBe(600); // alongside for the whole ten minutes
  });

  test('reports where both aircraft were at the closest approach', async () => {
    const above = straight('ABOVE', { x: 0, y: -66 }, { x: 0, y: 54 }, 36000, 0, 600);
    const store = storeOf(subject, above);

    const result = (await findNearbyFlights(store, subject.summary.flightId, { horizontalNm: 5, verticalFt: 1000 }))!;
    const [encounter] = result.encounters;
    expect(encounter.own.alt).toBe(35000);
    expect(encounter.other.alt).toBe(36000);
    expect(encounter.verticalFt).toBe(1000);
    expect(encounter.own.lon).toBeCloseTo(3, 3);
    expect(encounter.own.lat).toBeCloseTo(46.5, 3);
  });

  test('issues one vector search per probe point, including interpolated ones', async () => {
    const store = storeOf(subject);
    const result = (await findNearbyFlights(store, subject.summary.flightId, {
      horizontalNm: 5,
      verticalFt: 1000,
      probeStepSeconds: 30,
    }))!;
    // 11 reports a minute apart, plus one interpolated probe in each of the 10 gaps
    expect(result.stats.positionReports).toBe(11);
    expect(result.stats.searches).toBe(21);
    expect(store.searchCount).toBe(21);
  });

  test('returns undefined for an unknown flight', async () => {
    expect(
      await findNearbyFlights(storeOf(subject), 'NOPE#2026-10-01', { horizontalNm: 5, verticalFt: 1000 }),
    ).toBeUndefined();
  });

  test('analyses a flight with a single position report', async () => {
    const blip = flight('BLIP', [{ x: 1, y: 1, alt: 35000, t: 330 }]);
    const store = storeOf(subject, blip);

    const result = (await findNearbyFlights(store, blip.summary.flightId, { horizontalNm: 5, verticalFt: 1000 }))!;
    expect(result.encounters.map(({ callsign }) => callsign)).toEqual(['SUBJECT']);
    expect(result.encounters[0].horizontalKm).toBeCloseTo(Math.hypot(1, 1), 1);
  });
});
