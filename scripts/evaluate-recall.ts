/**
 * Measures how well the vector search finds real encounters, using the sample data.
 *
 *   npm run evaluate                     # default settings, 300 flights
 *   npm run evaluate -- --flights 1000
 *   npm run evaluate -- --sweep          # also compare TopK, probe spacing and time scale
 *
 * For each sampled flight, a brute-force comparison against every other flight
 * gives the true list of encounters. The two-stage search is then run and the
 * results compared. Recall is the share of true encounters that were found.
 *
 * DynamoDB's vector index is approximate, and this runs against an exact
 * in-memory search, so `--drop` simulates an index that randomly loses a share
 * of the neighbours it should have returned (default 5%).
 *
 * This is how the scaling factors and search settings in src/geo/vector-space.ts
 * and src/services/nearby-flights.ts were chosen.
 */

import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_SCALES } from '../src/geo/vector-space';
import { buildManifest, readRawFlights, toFlights } from '../src/ingest/flight-records';
import { NEARBY_DEFAULTS, findNearbyFlights } from '../src/services/nearby-flights';
import { MemoryFlightStore } from '../src/store/memory-flight-store';
import type { Flight, FlightStore } from '../src/store/types';
import { IndexedFlight, indexFlights, sample, seededRandom, trueEncounters } from '../test/ground-truth';

const { values: args } = parseArgs({
  options: {
    file: { type: 'string', default: path.join(__dirname, '..', 'data', 'France-Flights-2026-10-01.ndjson') },
    flights: { type: 'string', default: '300' },
    drop: { type: 'string', default: '0.05' },
    sweep: { type: 'boolean', default: false },
  },
});

const LIMITS: [horizontalNm: number, verticalFt: number][] = [
  [3, 1000],
  [5, 1000],
  [5, 2000],
  [10, 2000],
  [20, 5000],
];

interface Settings {
  topK: number;
  probeStepSeconds: number;
  kmPerSecond: number;
  drop: number;
}

/** Wraps a store so that each neighbour is independently lost with probability `drop` */
function lossy(store: FlightStore, drop: number): FlightStore {
  if (drop <= 0) return store;
  const random = seededRandom(12345);
  return {
    getManifest: () => store.getManifest(),
    listFlights: (date, bucket) => store.listFlights(date, bucket),
    getFlight: (flightId) => store.getFlight(flightId),
    getPositions: (flightId) => store.getPositions(flightId),
    searchPositions: async (vector, topK) => {
      const { hits } = await store.searchPositions(vector, topK);
      return { hits: hits.filter(() => random() >= drop) };
    },
  };
}

const stores = new Map<number, MemoryFlightStore>();
function storeFor(flights: readonly Flight[], kmPerSecond: number): MemoryFlightStore {
  if (!stores.has(kmPerSecond)) {
    const manifest = buildManifest(flights);
    manifest.vectorSpace = { ...manifest.vectorSpace, kmPerSecond };
    stores.set(kmPerSecond, new MemoryFlightStore(manifest, flights));
  }
  return stores.get(kmPerSecond)!;
}

interface Row {
  limits: string;
  encounters: number;
  found: number;
  recall: string;
  searches: string;
  candidates: string;
}

async function evaluate(
  flights: readonly Flight[],
  indexed: readonly IndexedFlight[],
  subjects: readonly IndexedFlight[],
  settings: Settings,
): Promise<Row[]> {
  const store = lossy(storeFor(flights, settings.kmPerSecond), settings.drop);
  const rows: Row[] = [];

  for (const [horizontalNm, verticalFt] of LIMITS) {
    let encounters = 0;
    let found = 0;
    let searches = 0;
    let candidates = 0;
    for (const subject of subjects) {
      const expected = trueEncounters(subject, indexed, horizontalNm, verticalFt);
      const result = (await findNearbyFlights(store, subject.flight.summary.flightId, {
        horizontalNm,
        verticalFt,
        topK: settings.topK,
        probeStepSeconds: settings.probeStepSeconds,
      }))!;
      const returned = new Set(result.encounters.map(({ flightId }) => flightId));
      encounters += expected.length;
      found += expected.filter(({ flightId }) => returned.has(flightId)).length;
      searches += result.stats.searches;
      candidates += result.stats.candidates;
    }
    rows.push({
      limits: `${horizontalNm} NM / ${verticalFt.toLocaleString()} ft`,
      encounters,
      found,
      recall: `${((100 * found) / Math.max(1, encounters)).toFixed(2)}%`,
      searches: (searches / subjects.length).toFixed(0),
      candidates: (candidates / subjects.length).toFixed(1),
    });
  }
  return rows;
}

function describeSettings({ topK, probeStepSeconds, kmPerSecond, drop }: Settings): string {
  const probes = probeStepSeconds > 0 ? `probe every ${probeStepSeconds}s` : 'probe at position reports only';
  return `TopK ${topK}, ${probes}, time scale ${kmPerSecond} km/s, ${(drop * 100).toFixed(0)}% of neighbours dropped`;
}

async function main(): Promise<void> {
  console.log(`Reading ${args.file}`);
  const flights = toFlights(await readRawFlights(args.file!));
  const indexed = indexFlights(flights);
  const subjects = sample(indexed, Number(args.flights), 7);
  console.log(`${flights.length.toLocaleString()} flights loaded, evaluating a sample of ${subjects.length}\n`);

  const chosen: Settings = {
    topK: NEARBY_DEFAULTS.topK,
    probeStepSeconds: NEARBY_DEFAULTS.probeStepSeconds,
    kmPerSecond: DEFAULT_SCALES.kmPerSecond,
    drop: Number(args.drop),
  };

  const variations: Settings[] = args.sweep
    ? [
        chosen,
        { ...chosen, drop: 0 },
        { ...chosen, topK: 50 },
        { ...chosen, topK: 20 },
        { ...chosen, topK: 10 },
        { ...chosen, probeStepSeconds: 0 },
        { ...chosen, kmPerSecond: 0.05 },
        { ...chosen, kmPerSecond: 0.05, topK: 20 },
        { ...chosen, kmPerSecond: 1 },
      ]
    : [chosen];

  for (const settings of variations) {
    console.log(describeSettings(settings));
    console.table(await evaluate(flights, indexed, subjects, settings));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
