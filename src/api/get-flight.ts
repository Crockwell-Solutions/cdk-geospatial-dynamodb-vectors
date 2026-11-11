/**
 * GET /api/flights/{flightId}
 *
 * Returns one flight with all of its position reports. Each report includes the
 * 4D vector it is indexed under, so the frontend can show exactly what the
 * vector index sees.
 */

import { toVector } from '../geo/vector-space';
import { CACHE_SECONDS, apiHandler, badRequest, json, notFound, pathParameter } from '../shared';
import { flightStore } from '../store';

export const handler = apiHandler(async (event) => {
  const flightId = pathParameter(event, 'flightId');
  if (!flightId) return badRequest('flightId is required');

  const store = flightStore();
  const [manifest, flight] = await Promise.all([store.getManifest(), store.getFlight(flightId)]);
  if (!manifest || !flight) return notFound(`Flight ${flightId} was not found`);

  const positions = flight.positions.map((position) => ({
    ...position,
    vec: toVector(manifest.vectorSpace, position),
  }));
  return json(200, { ...flight.summary, positions }, CACHE_SECONDS.flights);
});
