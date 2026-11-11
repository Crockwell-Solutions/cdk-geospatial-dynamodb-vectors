/**
 * DynamoDB implementation of the flight store.
 *
 * Three access patterns, three index types, one table:
 *
 *  - `getFlight`        Query on the table's primary key (one flight = one item collection)
 *  - `listFlights`      Query on GSI1 (flights starting in a given hour)
 *  - `searchPositions`  SearchVectors on the vector index (nearest position reports in 4D)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, SearchVectorsCommand } from '@aws-sdk/lib-dynamodb';
import type { Vector4 } from '../geo/vector-space';
import {
  LIST_INDEX,
  MANIFEST_KEY,
  POSITION_SORT_KEY_PREFIX,
  SUMMARY_SORT_KEY,
  VECTOR_INDEX,
  flightIdFromPartitionKey,
  flightPartitionKey,
  listPartitionKey,
} from './keys';
import type {
  DatasetManifest,
  Flight,
  FlightStore,
  FlightSummary,
  Position,
  VectorHit,
  VectorSearchResult,
} from './types';

type Item = Record<string, unknown>;

const SUMMARY_ATTRIBUTES: (keyof FlightSummary)[] = [
  'flightId',
  'callsign',
  'date',
  'icao',
  'registration',
  'aircraftType',
  'startTime',
  'endTime',
  'pointCount',
  'minAlt',
  'maxAlt',
  'track',
];

function toSummary(item: Item): FlightSummary {
  const summary: Item = {};
  for (const attribute of SUMMARY_ATTRIBUTES) {
    if (item[attribute] !== undefined) summary[attribute] = item[attribute];
  }
  return summary as unknown as FlightSummary;
}

const toPosition = (item: Item): Position => ({
  lon: item.lon as number,
  lat: item.lat as number,
  alt: item.alt as number,
  ts: item.ts as number,
  seg: item.seg as number,
});

/** How long a warm Lambda trusts its copy of the manifest before reading it again */
const MANIFEST_CACHE_MS = 60_000;

export function createDocumentClient(region?: string): DynamoDBDocumentClient {
  // A nearby-flights request fans out to a few hundred small requests; allow a few more
  // retries than the default so brief throttling is absorbed rather than surfaced.
  const client = new DynamoDBClient({ region, maxAttempts: 6 });
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

export class DynamoFlightStore implements FlightStore {
  private manifest?: { value: DatasetManifest | undefined; readAt: number };

  constructor(
    private readonly tableName: string,
    private readonly client: DynamoDBDocumentClient = createDocumentClient(),
  ) {}

  async getManifest(): Promise<DatasetManifest | undefined> {
    if (this.manifest && Date.now() - this.manifest.readAt < MANIFEST_CACHE_MS) {
      return this.manifest.value;
    }
    const { Item } = await this.client.send(new GetCommand({ TableName: this.tableName, Key: MANIFEST_KEY }));
    const value = Item?.manifest as DatasetManifest | undefined;
    this.manifest = { value, readAt: Date.now() };
    return value;
  }

  async listFlights(date: string, bucket: string): Promise<FlightSummary[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      IndexName: LIST_INDEX.name,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': LIST_INDEX.partitionKey },
      ExpressionAttributeValues: { ':pk': listPartitionKey(date, bucket) },
    });
    return items.map(toSummary);
  }

  async getFlight(flightId: string): Promise<Flight | undefined> {
    // The summary and every position report share a partition key, so one Query returns the lot
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'PK' },
      ExpressionAttributeValues: { ':pk': flightPartitionKey(flightId) },
    });
    const summary = items.find((item) => item.SK === SUMMARY_SORT_KEY);
    if (!summary) return undefined;
    const positions = items.filter((item) => String(item.SK).startsWith(POSITION_SORT_KEY_PREFIX)).map(toPosition);
    return { summary: toSummary(summary), positions };
  }

  async getPositions(flightId: string): Promise<Position[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': flightPartitionKey(flightId), ':prefix': POSITION_SORT_KEY_PREFIX },
    });
    return items.map(toPosition);
  }

  async searchPositions(vector: Vector4, topK: number): Promise<VectorSearchResult> {
    const response = await this.client.send(
      new SearchVectorsCommand({
        TableName: this.tableName,
        IndexName: VECTOR_INDEX.name,
        SearchVector: vector,
        TopK: topK,
        // Only attributes projected into the vector index can be returned; ask for just what we use
        ProjectionExpression: '#pk, #lon, #lat, #alt, #ts',
        ExpressionAttributeNames: { '#pk': 'PK', '#lon': 'lon', '#lat': 'lat', '#alt': 'alt', '#ts': 'ts' },
        ReturnConsumedCapacity: 'TOTAL',
      }),
    );

    const hits: VectorHit[] = (response.SearchResults ?? []).map(({ Item, Score }) => {
      const item = (Item ?? {}) as Item;
      return {
        flightId: flightIdFromPartitionKey(item.PK as string),
        position: {
          lon: item.lon as number,
          lat: item.lat as number,
          alt: item.alt as number,
          ts: item.ts as number,
        },
        score: Score ?? Number.NaN,
      };
    });
    return { hits, consumedBytes: response.ConsumedCapacity?.VectorSearchRequestBytes };
  }

  private async queryAll(input: ConstructorParameters<typeof QueryCommand>[0]): Promise<Item[]> {
    const items: Item[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(new QueryCommand({ ...input, ExclusiveStartKey }));
      items.push(...((page.Items ?? []) as Item[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }
}
