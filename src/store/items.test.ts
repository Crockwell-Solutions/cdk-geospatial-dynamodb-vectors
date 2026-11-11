import { straight } from '../../test/fixtures';
import { vectorSpaceFor } from '../ingest/flight-records';
import { flightItems, manifestItem, positionItems, summaryItem } from './items';

const flight = straight('AFR123', { x: -60, y: 0 }, { x: 60, y: 0 }, 35000, 0, 120);
const space = vectorSpaceFor('2026-10-01');

describe('DynamoDB items', () => {
  test('a flight summary is keyed by callsign and date, and listed by the hour it starts', () => {
    expect(summaryItem(flight)).toMatchObject({
      PK: 'FLIGHT#AFR123#2026-10-01',
      SK: 'META',
      GSI1PK: 'DAY#2026-10-01#12',
      GSI1SK: '2026-10-01T12:00:00.000Z#AFR123#2026-10-01',
      callsign: 'AFR123',
      pointCount: 3,
    });
    expect(summaryItem(flight)).not.toHaveProperty('vec');
  });

  test('a position report is keyed by its timestamp and carries a 4D vector', () => {
    const items = positionItems(flight, space);
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({
      PK: 'FLIGHT#AFR123#2026-10-01',
      SK: 'POS#2026-10-01T12:01:00.000Z',
      alt: 35000,
      seg: 0,
    });
    // [x km, y km, altitude at 9.26 km per 1,000 ft, seconds since midnight at 0.25 km/s]
    const vec = items[1].vec as number[];
    expect(vec).toHaveLength(4);
    expect(vec[0]).toBeCloseTo(0, 2);
    expect(vec[1]).toBeCloseTo(0, 2);
    expect(vec[2]).toBeCloseTo(324.1, 1);
    expect(vec[3]).toBeCloseTo((12 * 3600 + 60) * 0.25, 3);
  });

  test('position reports stay out of the list index, and summaries out of the vector index', () => {
    const [summary, ...positions] = flightItems(flight, space);
    expect(summary).toHaveProperty('GSI1PK');
    for (const position of positions) {
      expect(position).not.toHaveProperty('GSI1PK');
      expect(position).toHaveProperty('vec');
    }
  });

  test('the manifest is stored as a single item', () => {
    const manifest = { date: '2026-10-01' } as never;
    expect(manifestItem(manifest)).toEqual({ PK: 'DATASET', SK: 'MANIFEST', manifest });
  });
});
