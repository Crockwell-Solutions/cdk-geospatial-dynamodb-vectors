/**
 * Builds the DynamoDB items for a flight.
 *
 * A position report is an ordinary item with one extra attribute: `vec`, a list
 * of four numbers. That attribute is all the vector index needs. There is no
 * separate "vector write" API.
 */

import { VectorSpace, toVector } from '../geo/vector-space';
import {
  LIST_INDEX,
  MANIFEST_KEY,
  SUMMARY_SORT_KEY,
  VECTOR_INDEX,
  bucketOf,
  flightPartitionKey,
  listPartitionKey,
  listSortKey,
  positionSortKey,
} from './keys';
import type { DatasetManifest, Flight } from './types';

export type TableItem = Record<string, unknown>;

export function summaryItem({ summary }: Flight): TableItem {
  return {
    PK: flightPartitionKey(summary.flightId),
    SK: SUMMARY_SORT_KEY,
    [LIST_INDEX.partitionKey]: listPartitionKey(summary.date, bucketOf(summary.startTime)),
    [LIST_INDEX.sortKey]: listSortKey(summary.startTime, summary.flightId),
    ...summary,
  };
}

export function positionItems({ summary, positions }: Flight, space: VectorSpace): TableItem[] {
  const PK = flightPartitionKey(summary.flightId);
  return positions.map((position) => ({
    PK,
    SK: positionSortKey(position.ts),
    lon: position.lon,
    lat: position.lat,
    alt: position.alt,
    ts: position.ts,
    seg: position.seg,
    [VECTOR_INDEX.attribute]: toVector(space, position),
  }));
}

export function flightItems(flight: Flight, space: VectorSpace): TableItem[] {
  return [summaryItem(flight), ...positionItems(flight, space)];
}

export function manifestItem(manifest: DatasetManifest): TableItem {
  return { ...MANIFEST_KEY, manifest };
}
