/**
 * GET /api/flights?bucket=HH
 *
 * Returns the summary (including an encoded track) of every flight that started
 * in the given UTC hour. The browser requests all 24 buckets in parallel on
 * first load and caches the result.
 */

import { CACHE_SECONDS, apiHandler, badRequest, json, notFound } from '../shared';
import { flightStore } from '../store';

export const handler = apiHandler(async (event) => {
  const bucket = event.queryStringParameters?.bucket;
  if (!bucket || !/^([01]\d|2[0-3])$/.test(bucket)) {
    return badRequest('bucket must be a two-digit UTC hour between 00 and 23');
  }

  const store = flightStore();
  const manifest = await store.getManifest();
  if (!manifest) return notFound('No flight data has been loaded yet. Run `npm run load-data`.');

  const flights = await store.listFlights(manifest.date, bucket);
  return json(200, { date: manifest.date, bucket, version: manifest.version, flights }, CACHE_SECONDS.flights);
});
