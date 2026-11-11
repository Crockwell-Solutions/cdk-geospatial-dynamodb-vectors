/**
 * End-to-end check against the real sample data.
 *
 * For a sample of flights, the two-stage search (vector search for candidates,
 * then exact refinement) must find every encounter that a brute-force comparison
 * against all 14,444 flights finds, and report the same closest approach.
 *
 * The vector search here is the exact in-memory one. `npm run evaluate` goes
 * further and simulates an approximate index that drops a share of neighbours.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { buildManifest, readRawFlights, toFlights } from '../src/ingest/flight-records';
import { findNearbyFlights } from '../src/services/nearby-flights';
import { MemoryFlightStore } from '../src/store/memory-flight-store';
import { IndexedFlight, indexFlights, sample, trueEncounters } from './ground-truth';

const DATA_FILE = path.join(__dirname, '..', 'data', 'France-Flights-2026-10-01.ndjson');
const describeWithData = existsSync(DATA_FILE) ? describe : describe.skip;

describeWithData('recall on the France sample data', () => {
  let store: MemoryFlightStore;
  let indexed: IndexedFlight[];
  let subjects: IndexedFlight[];

  beforeAll(async () => {
    const flights = toFlights(await readRawFlights(DATA_FILE));
    store = new MemoryFlightStore(buildManifest(flights), flights);
    indexed = indexFlights(flights);
    subjects = sample(indexed, 30, 2026);
  }, 60_000);

  test.each([
    [3, 1000],
    [5, 1000],
    [10, 2000],
  ])(
    'finds every flight within %d NM and %d ft',
    async (horizontalNm, verticalFt) => {
      let expectedTotal = 0;
      for (const subject of subjects) {
        const expected = trueEncounters(subject, indexed, horizontalNm, verticalFt);
        const result = (await findNearbyFlights(store, subject.flight.summary.flightId, { horizontalNm, verticalFt }))!;

        expect(result.encounters.map(({ flightId }) => flightId).sort()).toEqual(
          expected.map(({ flightId }) => flightId).sort(),
        );
        for (const { flightId, approach } of expected) {
          const found = result.encounters.find((encounter) => encounter.flightId === flightId)!;
          expect(found.horizontalKm).toBeCloseTo(approach.horizontalKm, 1);
          expect(found.verticalFt).toBe(Math.round(approach.verticalFt));
        }
        expectedTotal += expected.length;
      }
      // Guard against a vacuous pass: the sample must actually contain encounters
      expect(expectedTotal).toBeGreaterThan(0);
    },
    120_000,
  );
});
