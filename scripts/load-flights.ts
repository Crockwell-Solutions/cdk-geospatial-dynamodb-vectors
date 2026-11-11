/**
 * Loads the sample flight data into DynamoDB.
 *
 *   npm run load-data                          # load data/France-Flights-2026-10-01.ndjson
 *   npm run load-data -- --limit 500           # just the first 500 flights, for a quick try
 *   npm run load-data -- --table MyTable --region eu-west-1
 *   npm run load-data -- --dry-run             # parse and report, write nothing
 *
 * Each flight becomes one summary item plus one item per position report. A
 * position report carries its 4D vector in the `vec` attribute; DynamoDB picks
 * that up and maintains the vector index asynchronously. Nothing else is needed
 * to "index" the data.
 *
 * Writes are rate limited to stay under the initial capacity of a new on-demand
 * table, and anything DynamoDB hands back as unprocessed is retried with backoff.
 */

import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_TABLE_NAME } from '../config/environment-config';
import { buildManifest, readRawFlights, toFlights } from '../src/ingest/flight-records';
import { chunkArray, mapWithConcurrency, sleep } from '../src/shared/utils';
import { TableItem, flightItems, manifestItem } from '../src/store/items';
import { VECTOR_INDEX } from '../src/store/keys';

const BATCH_SIZE = 25; // BatchWriteItem maximum

const { values: args } = parseArgs({
  options: {
    file: { type: 'string', default: path.join(__dirname, '..', 'data', 'France-Flights-2026-10-01.ndjson') },
    table: { type: 'string', default: process.env.TABLE_NAME ?? DEFAULT_TABLE_NAME },
    region: { type: 'string', default: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION },
    limit: { type: 'string' },
    rate: { type: 'string', default: '3000' },
    concurrency: { type: 'string', default: '8' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const tableName = args.table!;
const itemsPerSecond = Number(args.rate);
const concurrency = Number(args.concurrency);

const dynamo = new DynamoDBClient({ region: args.region, maxAttempts: 10 });
const client = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

/** Simple pacing: each batch reserves the next free slot on a shared timeline */
let nextSlot = Date.now();
async function pace(items: number): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + (items / itemsPerSecond) * 1000;
  if (start > now) await sleep(start - now);
}

async function writeBatch(items: TableItem[]): Promise<void> {
  let pending = items;
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt > 12) throw new Error(`Gave up writing ${pending.length} items after ${attempt} attempts`);
    if (attempt > 0) await sleep(Math.min(8000, 100 * 2 ** attempt) * (0.5 + Math.random()));
    await pace(pending.length);
    const response = await client.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: pending.map((Item) => ({ PutRequest: { Item } })) } }),
    );
    pending = (response.UnprocessedItems?.[tableName] ?? []).map((request) => request.PutRequest!.Item as TableItem);
  }
}

async function describeVectorIndex(): Promise<string> {
  const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
  const index = Table?.VectorIndexes?.find(({ IndexName }) => IndexName === VECTOR_INDEX.name);
  if (!index) {
    throw new Error(
      `Table ${tableName} has no vector index named "${VECTOR_INDEX.name}". Deploy the stacks first with \`npm run deploy\`.`,
    );
  }
  return `${index.IndexStatus}${index.Backfilling ? ' (backfilling)' : ''}, ${index.Dimensions} dimensions, ${index.DistanceFunction}`;
}

async function main(): Promise<void> {
  const limit = args.limit ? Number(args.limit) : Infinity;
  console.log(`Reading ${args.file}`);
  const flights = toFlights(await readRawFlights(args.file!, limit));
  const manifest = buildManifest(flights);
  const items = flights.flatMap((flight) => flightItems(flight, manifest.vectorSpace));

  console.log(`  ${manifest.flights.toLocaleString()} flights on ${manifest.date}`);
  console.log(`  ${manifest.positions.toLocaleString()} position reports, each with a 4D vector`);
  console.log(`  ${items.length.toLocaleString()} items to write`);
  const sample = items.find((item) => VECTOR_INDEX.attribute in item);
  console.log('  Example position item:', JSON.stringify(sample));

  if (args['dry-run']) {
    console.log('Dry run: nothing written.');
    return;
  }

  console.log(`Table ${tableName}, vector index "${VECTOR_INDEX.name}": ${await describeVectorIndex()}`);

  const started = Date.now();
  let written = 0;
  const report = (): void => {
    const elapsed = (Date.now() - started) / 1000;
    const percent = ((100 * written) / items.length).toFixed(1);
    process.stdout.write(
      `\r  ${written.toLocaleString()} / ${items.length.toLocaleString()} items (${percent}%) in ${elapsed.toFixed(0)}s  `,
    );
  };
  const progress = setInterval(report, 1000);
  try {
    await mapWithConcurrency(chunkArray(items, BATCH_SIZE), concurrency, async (batch) => {
      await writeBatch(batch);
      written += batch.length;
    });
  } finally {
    clearInterval(progress);
  }
  report();
  console.log();

  // Written last, so the application only ever sees a manifest for a complete dataset
  await client.send(new PutCommand({ TableName: tableName, Item: manifestItem(manifest) }));

  console.log(`Done. Vector index: ${await describeVectorIndex()}`);
  console.log('The index is updated asynchronously, so allow a moment before the first search.');
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
