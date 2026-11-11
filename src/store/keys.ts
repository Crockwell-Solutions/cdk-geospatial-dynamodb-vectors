/**
 * Single-table key design.
 *
 * | Item              | PK                       | SK                    | Indexed by              |
 * |-------------------|--------------------------|-----------------------|-------------------------|
 * | Flight summary    | FLIGHT#<callsign>#<date> | META                  | GSI1 (list by hour)     |
 * | Position report   | FLIGHT#<callsign>#<date> | POS#<ISO timestamp>   | Vector index on `vec`   |
 * | Dataset manifest  | DATASET                  | MANIFEST              |                         |
 *
 * Both indexes are sparse. Only summaries carry GSI1 keys and only position
 * reports carry a `vec` attribute, so each index contains exactly one item type.
 */

export const TABLE_KEYS = {
  partitionKey: 'PK',
  sortKey: 'SK',
} as const;

export const LIST_INDEX = {
  name: 'GSI1',
  partitionKey: 'GSI1PK',
  sortKey: 'GSI1SK',
} as const;

export const VECTOR_INDEX = {
  name: 'position-4d',
  attribute: 'vec',
} as const;

export const SUMMARY_SORT_KEY = 'META';
export const POSITION_SORT_KEY_PREFIX = 'POS#';

const FLIGHT_PREFIX = 'FLIGHT#';

export const flightPartitionKey = (flightId: string): string => `${FLIGHT_PREFIX}${flightId}`;

export const flightIdFromPartitionKey = (partitionKey: string): string => partitionKey.slice(FLIGHT_PREFIX.length);

export const positionSortKey = (ts: number): string =>
  `${POSITION_SORT_KEY_PREFIX}${new Date(Math.round(ts * 1000)).toISOString()}`;

/** Flights are listed by the UTC hour in which they start: 24 small partitions that can be fetched in parallel */
export const bucketOf = (startTime: string): string => startTime.slice(11, 13);

export const listPartitionKey = (date: string, bucket: string): string => `DAY#${date}#${bucket}`;

export const listSortKey = (startTime: string, flightId: string): string => `${startTime}#${flightId}`;

export const MANIFEST_KEY = { PK: 'DATASET', SK: 'MANIFEST' } as const;
