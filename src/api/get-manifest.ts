/**
 * GET /api/manifest
 *
 * Describes the loaded dataset: how many flights, which hourly buckets to fetch,
 * and a version the browser uses to decide whether its cached copy is still good.
 */

import { CACHE_SECONDS, apiHandler, json, notFound } from '../shared';
import { flightStore } from '../store';

export const handler = apiHandler(async () => {
  const manifest = await flightStore().getManifest();
  if (!manifest) return notFound('No flight data has been loaded yet. Run `npm run load-data`.');
  return json(200, manifest, CACHE_SECONDS.manifest);
});
