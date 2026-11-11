import { straight, storeOf } from '../../test/fixtures';
import { toVector, vectorDistance } from '../geo/vector-space';

describe('in-memory vector search', () => {
  // A grid of parallel tracks at different levels and times
  const flights = Array.from({ length: 40 }, (_, i) =>
    straight(
      `TRK${i}`,
      { x: -100, y: i * 7 - 140 },
      { x: 100, y: i * 7 - 140 },
      30000 + (i % 5) * 1000,
      i * 45,
      i * 45 + 900,
    ),
  );
  const store = storeOf(...flights);

  test('returns exactly the nearest reports, nearest first', async () => {
    const { vectorSpace } = await store.getManifest();
    const query = toVector(vectorSpace, { lon: 3.1, lat: 46.4, alt: 32500, ts: flights[0].positions[0].ts + 1000 });

    const { hits } = await store.searchPositions(query, 25);

    const everything = flights
      .flatMap((flight) => flight.positions.map((position) => vectorDistance(query, toVector(vectorSpace, position))))
      .sort((a, b) => a - b);
    expect(hits).toHaveLength(25);
    hits.forEach((hit, i) => expect(hit.score).toBeCloseTo(everything[i], 2));
  });

  test('returns everything when asked for more than there is', async () => {
    const small = storeOf(flights[0]);
    const { vectorSpace } = await small.getManifest();
    const { hits } = await small.searchPositions(toVector(vectorSpace, flights[0].positions[3]), 100);
    expect(hits).toHaveLength(flights[0].positions.length);
    expect(hits[0].score).toBeCloseTo(0, 3);
    expect(hits[0].flightId).toBe(flights[0].summary.flightId);
  });

  test('lists flights by the hour in which they start', async () => {
    expect(await store.listFlights('2026-10-01', '12')).toHaveLength(40);
    expect(await store.listFlights('2026-10-01', '13')).toEqual([]);
  });
});
