import { decodePolyline } from '../geo/polyline';
import { RawFlightRecord, buildManifest, toFlights, vectorSpaceFor } from './flight-records';

const T0 = Date.parse('2026-10-01T06:20:10.600Z') / 1000;

const record = (overrides: Partial<RawFlightRecord> = {}): RawFlightRecord => ({
  id: 'abc-1',
  date: '2026-10-01',
  callsign: 'IBE07TT',
  icao: '3423C4',
  registration: 'EC-JRE',
  aircraftType: 'A321',
  startTime: '2026-10-01T06:20:10.601Z',
  endTime: '2026-10-01T06:22:10.601Z',
  segments: [
    [
      [-2.07524, 43.15, 34000, T0],
      [-1.98133, 43.29111, 34013, T0 + 60],
      [-1.84564, 43.49555, 33975, T0 + 120],
    ],
  ],
  ...overrides,
});

describe('building flights from raw records', () => {
  test('identifies a flight by callsign and date', () => {
    const [flight] = toFlights([record()]);
    expect(flight.summary).toMatchObject({
      flightId: 'IBE07TT#2026-10-01',
      callsign: 'IBE07TT',
      date: '2026-10-01',
      icao: '3423C4',
      registration: 'EC-JRE',
      aircraftType: 'A321',
      startTime: '2026-10-01T06:20:10.600Z',
      endTime: '2026-10-01T06:22:10.600Z',
      pointCount: 3,
      minAlt: 33975,
      maxAlt: 34013,
    });
    expect(flight.positions[0]).toEqual({ lon: -2.07524, lat: 43.15, alt: 34000, ts: T0, seg: 0 });
  });

  test('numbers repeat uses of a callsign on the same day in order of departure', () => {
    const flights = toFlights([
      record({ id: 'c', startTime: '2026-10-01T15:00:00.000Z' }),
      record({ id: 'a', startTime: '2026-10-01T05:00:00.000Z' }),
      record({ id: 'b', startTime: '2026-10-01T09:00:00.000Z' }),
    ]);
    expect(flights.map(({ summary }) => summary.flightId)).toEqual([
      'IBE07TT#2026-10-01',
      'IBE07TT#2026-10-01#2',
      'IBE07TT#2026-10-01#3',
    ]);
  });

  test('falls back to the ICAO address when there is no callsign', () => {
    const [flight] = toFlights([record({ callsign: null, registration: null, aircraftType: null })]);
    expect(flight.summary.flightId).toBe('3423C4#2026-10-01');
    expect(flight.summary.callsign).toBe('3423C4');
    expect(flight.summary).not.toHaveProperty('registration');
    expect(flight.summary).not.toHaveProperty('aircraftType');
  });

  test('keeps segments apart and encodes one polyline for each', () => {
    const [flight] = toFlights([
      record({
        segments: [
          [
            [1, 45, 30000, T0],
            [1.1, 45.1, 30000, T0 + 60],
          ],
          [
            [2, 46, 30000, T0 + 900],
            [2.1, 46.1, 30000, T0 + 960],
          ],
        ],
      }),
    ]);
    expect(flight.positions.map(({ seg }) => seg)).toEqual([0, 0, 1, 1]);
    expect(flight.summary.track).toHaveLength(2);
    expect(decodePolyline(flight.summary.track[1])).toEqual([
      [2, 46],
      [2.1, 46.1],
    ]);
  });

  test('drops repeated timestamps, which would otherwise share a sort key', () => {
    const [flight] = toFlights([
      record({
        segments: [
          [
            [1, 45, 30000, T0],
            [1.01, 45.01, 30000, T0],
            [1.1, 45.1, 30000, T0 + 60],
          ],
        ],
      }),
    ]);
    expect(flight.positions).toHaveLength(2);
  });

  test('skips records with no position reports', () => {
    expect(toFlights([record({ segments: [] })])).toEqual([]);
  });
});

describe('dataset manifest', () => {
  test('counts flights per starting hour and records how vectors are encoded', () => {
    const flights = toFlights([
      record({ id: 'a' }),
      record({ id: 'b', callsign: 'AFR123' }),
      record({ id: 'c', callsign: 'EZY456', segments: [[[1, 45, 30000, T0 + 3 * 3600]]] }),
    ]);
    const manifest = buildManifest(flights, new Date('2026-11-11T10:00:00Z'));

    expect(manifest).toMatchObject({
      date: '2026-10-01',
      flights: 3,
      positions: 7,
      loadedAt: '2026-11-11T10:00:00.000Z',
    });
    expect(manifest.buckets).toEqual([
      { bucket: '06', flights: 2 },
      { bucket: '09', flights: 1 },
    ]);
    expect(manifest.vectorSpace).toEqual(vectorSpaceFor('2026-10-01'));
    expect(manifest.vectorSpace.epochSeconds).toBe(Date.parse('2026-10-01T00:00:00Z') / 1000);
  });

  test('gets a new version each time the data is loaded', () => {
    const flights = toFlights([record()]);
    const first = buildManifest(flights, new Date('2026-11-11T10:00:00Z'));
    const second = buildManifest(flights, new Date('2026-11-11T10:05:00Z'));
    expect(first.version).not.toBe(second.version);
  });

  test('refuses a dataset that spans more than one date', () => {
    const flights = toFlights([record(), record({ id: 'b', date: '2026-10-02' })]);
    expect(() => buildManifest(flights)).toThrow(/single date/);
  });
});
