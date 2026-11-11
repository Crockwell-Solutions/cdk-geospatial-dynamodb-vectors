/**
 * GET /api/health
 *
 * Reports whether the table and its vector index are ready. A vector index can
 * still be CREATING (or backfilling) after the table itself is ACTIVE, and there
 * is no SDK waiter for it, so this is the quickest way to check after a deploy.
 */

import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { apiHandler, json } from '../shared';
import { flightStore } from '../store';
import { VECTOR_INDEX } from '../store/keys';

const client = new DynamoDBClient({});

export const handler = apiHandler(async () => {
  const [{ Table }, manifest] = await Promise.all([
    client.send(new DescribeTableCommand({ TableName: process.env.TABLE_NAME! })),
    flightStore().getManifest(),
  ]);

  const index = Table?.VectorIndexes?.find(({ IndexName }) => IndexName === VECTOR_INDEX.name);
  const ready = Table?.TableStatus === 'ACTIVE' && index?.IndexStatus === 'ACTIVE' && !index.Backfilling && !!manifest;

  return json(ready ? 200 : 503, {
    status: ready ? 'ready' : 'not-ready',
    table: { name: Table?.TableName, status: Table?.TableStatus },
    vectorIndex: index
      ? {
          name: index.IndexName,
          status: index.IndexStatus,
          backfilling: index.Backfilling ?? false,
          dimensions: index.Dimensions,
          distanceFunction: index.DistanceFunction,
          // Updated by DynamoDB roughly every six hours, so expect 0 straight after a load
          approximateItemCount: index.ItemCount,
        }
      : undefined,
    dataset: manifest
      ? { date: manifest.date, flights: manifest.flights, positions: manifest.positions, loadedAt: manifest.loadedAt }
      : undefined,
  });
});
