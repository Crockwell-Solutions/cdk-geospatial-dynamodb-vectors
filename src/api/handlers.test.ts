import type { APIGatewayProxyEvent } from 'aws-lambda';
import { straight, storeOf } from '../../test/fixtures';
import { setFlightStore } from '../store';
import type { FlightStore } from '../store/types';
import { handler as findNearbyFlights } from './find-nearby-flights';
import { handler as getFlight } from './get-flight';
import { handler as getManifest } from './get-manifest';
import { handler as listFlights } from './list-flights';

const subject = straight('SUBJECT', { x: -66, y: 0 }, { x: 54, y: 0 }, 35000, 0, 600);
const crosser = straight('CROSSER', { x: 0, y: -66 }, { x: 0, y: 54 }, 35000, 0, 600);

const event = (pathParameters: Record<string, string> = {}, query: Record<string, string> = {}): APIGatewayProxyEvent =>
  ({ path: '/test', pathParameters, queryStringParameters: query }) as unknown as APIGatewayProxyEvent;

beforeEach(() => setFlightStore(storeOf(subject, crosser)));
afterAll(() => setFlightStore(undefined));

describe('GET /api/manifest', () => {
  test('describes the loaded dataset', async () => {
    const response = await getManifest(event());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ date: '2026-10-01', flights: 2, positions: 22 });
    expect(response.headers).toMatchObject({ 'Cache-Control': 'public, max-age=30' });
  });

  test('says so when nothing has been loaded', async () => {
    setFlightStore({ getManifest: async () => undefined } as unknown as FlightStore);
    const response = await getManifest(event());
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).message).toMatch(/load-data/);
  });
});

describe('GET /api/flights', () => {
  test('returns the flights that start in the requested hour', async () => {
    const response = await listFlights(event({}, { bucket: '12' }));
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.flights.map((flight: { callsign: string }) => flight.callsign)).toEqual(['SUBJECT', 'CROSSER']);
    expect(body.flights[0].track[0]).toEqual(expect.any(String));
    expect(body.flights[0]).not.toHaveProperty('positions');
  });

  test.each([[undefined], ['24'], ['8'], ['ab']])('rejects bucket %p', async (bucket) => {
    const response = await listFlights(event({}, bucket === undefined ? {} : { bucket }));
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/flights/{flightId}', () => {
  test('returns a flight with its position reports', async () => {
    const response = await getFlight(event({ flightId: 'SUBJECT#2026-10-01' }));
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.callsign).toBe('SUBJECT');
    expect(body.positions).toHaveLength(11);
  });

  test('accepts an id that is still percent-encoded', async () => {
    const response = await getFlight(event({ flightId: 'SUBJECT%232026-10-01' }));
    expect(response.statusCode).toBe(200);
  });

  test('responds 404 for an unknown flight', async () => {
    expect((await getFlight(event({ flightId: 'NOPE#2026-10-01' }))).statusCode).toBe(404);
  });
});

describe('GET /api/flights/{flightId}/nearby', () => {
  test('returns encounters and never caches them', async () => {
    const response = await findNearbyFlights(
      event({ flightId: 'SUBJECT#2026-10-01' }, { horizontalNm: '3', verticalFt: '500' }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    const body = JSON.parse(response.body);
    expect(body.limits).toEqual({ horizontalNm: 3, verticalFt: 500 });
    expect(body.encounters.map((encounter: { callsign: string }) => encounter.callsign)).toEqual(['CROSSER']);
    expect(body.stats.searches).toBeGreaterThan(0);
  });

  test('defaults to 5 NM and 1,000 ft', async () => {
    const response = await findNearbyFlights(event({ flightId: 'SUBJECT#2026-10-01' }));
    expect(JSON.parse(response.body).limits).toEqual({ horizontalNm: 5, verticalFt: 1000 });
  });

  test.each([
    [{ horizontalNm: '0' }],
    [{ horizontalNm: '21' }],
    [{ horizontalNm: 'far' }],
    [{ verticalFt: '-1' }],
    [{ verticalFt: '5001' }],
  ])('rejects out-of-range limits %p', async (query) => {
    const response = await findNearbyFlights(event({ flightId: 'SUBJECT#2026-10-01' }, query));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toMatch(/must be a number between/);
  });

  test('responds 404 for an unknown flight', async () => {
    expect((await findNearbyFlights(event({ flightId: 'NOPE#2026-10-01' }))).statusCode).toBe(404);
  });

  test('responds 503 while the vector index is not ready', async () => {
    const working = storeOf(subject, crosser);
    setFlightStore({
      getManifest: () => working.getManifest(),
      getFlight: (id: string) => working.getFlight(id),
      searchPositions: async () => {
        throw Object.assign(new Error('Index is backfilling'), { name: 'ValidationException' });
      },
    } as unknown as FlightStore);

    const response = await findNearbyFlights(event({ flightId: 'SUBJECT#2026-10-01' }));
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toBe('ValidationException');
  });
});
