import { DynamoDBDocumentClient, GetCommand, QueryCommand, SearchVectorsCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoFlightStore } from './dynamo-flight-store';

const dynamo = mockClient(DynamoDBDocumentClient);
const store = (): DynamoFlightStore =>
  new DynamoFlightStore('FlightVectors', dynamo as unknown as DynamoDBDocumentClient);

beforeEach(() => dynamo.reset());

describe('DynamoDB flight store', () => {
  test('searches the vector index with a plain list of four numbers', async () => {
    dynamo.on(SearchVectorsCommand).resolves({
      SearchResults: [
        { Item: { PK: 'FLIGHT#AFR123#2026-10-01', lon: 2.5, lat: 48.9, alt: 35000, ts: 1790856000 }, Score: 1.25 },
        { Item: { PK: 'FLIGHT#EZY456#2026-10-01#2', lon: 2.6, lat: 48.8, alt: 36000, ts: 1790856030 }, Score: 12.5 },
      ],
      ConsumedCapacity: { VectorSearchRequestBytes: 2048 },
    });

    const result = await store().searchPositions([-47.531, 262.035, 324.1, 10800], 100);

    expect(dynamo.commandCalls(SearchVectorsCommand)[0].args[0].input).toEqual({
      TableName: 'FlightVectors',
      IndexName: 'position-4d',
      SearchVector: [-47.531, 262.035, 324.1, 10800],
      TopK: 100,
      ProjectionExpression: '#pk, #lon, #lat, #alt, #ts',
      ExpressionAttributeNames: { '#pk': 'PK', '#lon': 'lon', '#lat': 'lat', '#alt': 'alt', '#ts': 'ts' },
      ReturnConsumedCapacity: 'TOTAL',
    });
    expect(result).toEqual({
      hits: [
        { flightId: 'AFR123#2026-10-01', position: { lon: 2.5, lat: 48.9, alt: 35000, ts: 1790856000 }, score: 1.25 },
        { flightId: 'EZY456#2026-10-01#2', position: { lon: 2.6, lat: 48.8, alt: 36000, ts: 1790856030 }, score: 12.5 },
      ],
      consumedBytes: 2048,
    });
  });

  test('copes with a search that finds nothing', async () => {
    dynamo.on(SearchVectorsCommand).resolves({});
    expect(await store().searchPositions([0, 0, 0, 0], 10)).toEqual({ hits: [], consumedBytes: undefined });
  });

  test('reads a flight and its position reports with one query, following pagination', async () => {
    dynamo
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          {
            PK: 'FLIGHT#AFR123#2026-10-01',
            SK: 'META',
            GSI1PK: 'DAY#2026-10-01#12',
            flightId: 'AFR123#2026-10-01',
            callsign: 'AFR123',
            pointCount: 2,
          },
          {
            PK: 'FLIGHT#AFR123#2026-10-01',
            SK: 'POS#2026-10-01T12:00:00.000Z',
            lon: 2.5,
            lat: 48.9,
            alt: 35000,
            ts: 1790856000,
            seg: 0,
            vec: [1, 2, 3, 4],
          },
        ],
        LastEvaluatedKey: { PK: 'FLIGHT#AFR123#2026-10-01', SK: 'POS#2026-10-01T12:00:00.000Z' },
      })
      .resolvesOnce({
        Items: [
          {
            PK: 'FLIGHT#AFR123#2026-10-01',
            SK: 'POS#2026-10-01T12:01:00.000Z',
            lon: 2.6,
            lat: 48.8,
            alt: 35000,
            ts: 1790856060,
            seg: 0,
            vec: [1, 2, 3, 5],
          },
        ],
      });

    const flight = await store().getFlight('AFR123#2026-10-01');

    expect(flight).toEqual({
      summary: { flightId: 'AFR123#2026-10-01', callsign: 'AFR123', pointCount: 2 },
      positions: [
        { lon: 2.5, lat: 48.9, alt: 35000, ts: 1790856000, seg: 0 },
        { lon: 2.6, lat: 48.8, alt: 35000, ts: 1790856060, seg: 0 },
      ],
    });
    const calls = dynamo.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: 'FlightVectors',
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeValues: { ':pk': 'FLIGHT#AFR123#2026-10-01' },
    });
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({
      PK: 'FLIGHT#AFR123#2026-10-01',
      SK: 'POS#2026-10-01T12:00:00.000Z',
    });
  });

  test('returns undefined for a flight that does not exist', async () => {
    dynamo.on(QueryCommand).resolves({ Items: [] });
    expect(await store().getFlight('NOPE#2026-10-01')).toBeUndefined();
  });

  test('lists flights for an hour from the list index', async () => {
    dynamo.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'FLIGHT#AFR123#2026-10-01',
          SK: 'META',
          GSI1PK: 'DAY#2026-10-01#08',
          GSI1SK: 'x',
          flightId: 'AFR123#2026-10-01',
          track: ['abc'],
        },
      ],
    });

    expect(await store().listFlights('2026-10-01', '08')).toEqual([{ flightId: 'AFR123#2026-10-01', track: ['abc'] }]);
    expect(dynamo.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeNames: { '#pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':pk': 'DAY#2026-10-01#08' },
    });
  });

  test('reads only position reports when asked for positions', async () => {
    dynamo.on(QueryCommand).resolves({ Items: [{ lon: 1, lat: 2, alt: 3, ts: 4, seg: 0 }] });
    expect(await store().getPositions('AFR123#2026-10-01')).toEqual([{ lon: 1, lat: 2, alt: 3, ts: 4, seg: 0 }]);
    expect(dynamo.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeValues: { ':pk': 'FLIGHT#AFR123#2026-10-01', ':prefix': 'POS#' },
    });
  });

  test('caches the manifest between calls', async () => {
    const manifest = { date: '2026-10-01', version: 'v1' };
    dynamo.on(GetCommand).resolves({ Item: { PK: 'DATASET', SK: 'MANIFEST', manifest } });
    const subject = store();

    expect(await subject.getManifest()).toEqual(manifest);
    expect(await subject.getManifest()).toEqual(manifest);
    expect(dynamo.commandCalls(GetCommand)).toHaveLength(1);
    expect(dynamo.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: 'FlightVectors',
      Key: { PK: 'DATASET', SK: 'MANIFEST' },
    });
  });

  test('reports a missing manifest as undefined, and looks again next time', async () => {
    dynamo
      .on(GetCommand)
      .resolvesOnce({})
      .resolves({ Item: { manifest: { date: '2026-10-01' } } });
    const subject = store();

    expect(await subject.getManifest()).toBeUndefined();
    expect(await subject.getManifest()).toEqual({ date: '2026-10-01' });
  });
});
