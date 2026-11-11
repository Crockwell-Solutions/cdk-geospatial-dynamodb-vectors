/**
 * Runs the flights API on your machine, with no AWS account needed.
 *
 *   npm run local-api            # http://localhost:3001
 *
 * The same Lambda handlers are used as in the deployed API. The only difference
 * is the store behind them: the flight file is loaded into memory and vector
 * searches are answered by an exact nearest-neighbour scan instead of the
 * DynamoDB vector index. Handy for working on the frontend, and for seeing what
 * the application does before deploying anything.
 */

import { createServer } from 'node:http';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler as findNearbyFlights } from '../src/api/find-nearby-flights';
import { handler as getFlight } from '../src/api/get-flight';
import { handler as getManifest } from '../src/api/get-manifest';
import { handler as listFlights } from '../src/api/list-flights';
import { buildManifest, readRawFlights, toFlights } from '../src/ingest/flight-records';
import { setFlightStore } from '../src/store';
import { MemoryFlightStore } from '../src/store/memory-flight-store';

const { values: args } = parseArgs({
  options: {
    file: { type: 'string', default: path.join(__dirname, '..', 'data', 'France-Flights-2026-10-01.ndjson') },
    port: { type: 'string', default: process.env.PORT ?? '3001' },
    limit: { type: 'string' },
  },
});

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

const routes: { pattern: RegExp; handler: Handler }[] = [
  { pattern: /^\/api\/manifest$/, handler: getManifest },
  { pattern: /^\/api\/flights$/, handler: listFlights },
  { pattern: /^\/api\/flights\/(?<flightId>[^/]+)\/nearby$/, handler: findNearbyFlights },
  { pattern: /^\/api\/flights\/(?<flightId>[^/]+)$/, handler: getFlight },
];

async function main(): Promise<void> {
  const limit = args.limit ? Number(args.limit) : Infinity;
  console.log(`Loading ${args.file} into memory...`);
  const flights = toFlights(await readRawFlights(args.file!, limit));
  const manifest = buildManifest(flights);
  setFlightStore(new MemoryFlightStore(manifest, flights));
  console.log(
    `  ${manifest.flights.toLocaleString()} flights, ${manifest.positions.toLocaleString()} position reports`,
  );

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const started = Date.now();
    let result: APIGatewayProxyResult = { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };

    if (request.method === 'GET') {
      for (const route of routes) {
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        result = await route.handler({
          path: url.pathname,
          httpMethod: 'GET',
          pathParameters: match.groups ?? null,
          queryStringParameters: Object.fromEntries(url.searchParams),
        } as unknown as APIGatewayProxyEvent);
        break;
      }
    }

    response.writeHead(result.statusCode, { 'Content-Type': 'application/json', ...result.headers });
    response.end(result.body);
    console.log(`${result.statusCode} ${request.method} ${url.pathname}${url.search} ${Date.now() - started}ms`);
  });

  server.listen(Number(args.port), () => {
    console.log(`Local flights API listening on http://localhost:${args.port}`);
    console.log('Start the frontend in another terminal with: npm run frontend');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
