/**
 * GET /api/flights/{flightId}
 *
 * Returns one flight with all of its position reports.
 */

import { CACHE_SECONDS, apiHandler, badRequest, json, notFound, pathParameter } from '../shared';
import { flightStore } from '../store';

export const handler = apiHandler(async (event) => {
  const flightId = pathParameter(event, 'flightId');
  if (!flightId) return badRequest('flightId is required');

  const flight = await flightStore().getFlight(flightId);
  if (!flight) return notFound(`Flight ${flightId} was not found`);

  return json(200, { ...flight.summary, positions: flight.positions }, CACHE_SECONDS.flights);
});
