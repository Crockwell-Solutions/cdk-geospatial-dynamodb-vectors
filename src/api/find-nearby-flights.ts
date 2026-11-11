/**
 * GET /api/flights/{flightId}/nearby?horizontalNm=5&verticalFt=1000
 *
 * The interesting one. Runs a vector search for every point along the flight,
 * in parallel, then confirms each candidate with an exact closest-approach
 * calculation. See src/services/nearby-flights.ts.
 */

import { NEARBY_DEFAULTS, NEARBY_LIMITS, findNearbyFlights } from '../services/nearby-flights';
import { apiHandler, badRequest, json, logger, notFound, numberParameter, pathParameter } from '../shared';
import { flightStore } from '../store';

export const handler = apiHandler(async (event) => {
  const flightId = pathParameter(event, 'flightId');
  if (!flightId) return badRequest('flightId is required');

  const horizontalNm = numberParameter(event, 'horizontalNm', NEARBY_DEFAULTS.horizontalNm, NEARBY_LIMITS.horizontalNm);
  const verticalFt = numberParameter(event, 'verticalFt', NEARBY_DEFAULTS.verticalFt, NEARBY_LIMITS.verticalFt);

  const result = await findNearbyFlights(flightStore(), flightId, { horizontalNm, verticalFt });
  if (!result) return notFound(`Flight ${flightId} was not found`);

  logger.info('Nearby flights analysed', { flightId, horizontalNm, verticalFt, ...result.stats });
  return json(200, result);
});
