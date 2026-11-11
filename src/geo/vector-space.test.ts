import {
  DEFAULT_SCALES,
  KM_PER_NM,
  SAMPLING_SLACK_KM,
  VECTOR_DIMENSIONS,
  VectorSpace,
  candidateRadiusKm,
  toVector,
  vectorDistance,
} from './vector-space';

const space: VectorSpace = { epochSeconds: Date.UTC(2026, 9, 1) / 1000, ...DEFAULT_SCALES };
const noon = space.epochSeconds + 12 * 3600;

describe('4D vector space', () => {
  test('a position becomes four numbers', () => {
    const vector = toVector(space, { lon: 3, lat: 46.5, alt: 35000, ts: noon });
    expect(vector).toHaveLength(VECTOR_DIMENSIONS);
    expect(vector[0]).toBeCloseTo(0, 3);
    expect(vector[1]).toBeCloseTo(0, 3);
  });

  test('1,000 ft of altitude is the same distance as 5 NM', () => {
    const level = toVector(space, { lon: 3, lat: 46.5, alt: 35000, ts: noon });
    const above = toVector(space, { lon: 3, lat: 46.5, alt: 36000, ts: noon });
    expect(vectorDistance(level, above)).toBeCloseTo(5 * KM_PER_NM, 2);
  });

  test('one minute of time is the same distance as 15 km', () => {
    const now = toVector(space, { lon: 3, lat: 46.5, alt: 35000, ts: noon });
    const later = toVector(space, { lon: 3, lat: 46.5, alt: 35000, ts: noon + 60 });
    expect(vectorDistance(now, later)).toBeCloseTo(15, 3);
  });

  test('horizontal distance is in kilometres', () => {
    const here = toVector(space, { lon: 3, lat: 46.5, alt: 35000, ts: noon });
    const north = toVector(space, { lon: 3, lat: 46.5 + 1 / 60, alt: 35000, ts: noon }); // one arc minute = 1 NM
    expect(vectorDistance(here, north)).toBeCloseTo(KM_PER_NM, 1);
  });

  test('values survive being stored as 32-bit floats to within a few metres', () => {
    // The largest component is time at the end of the day: 86,400 s * 0.25 = 21,600
    const vector = toVector(space, { lon: 8.53, lat: 50.15, alt: 47000, ts: space.epochSeconds + 86399.9 });
    const stored = Array.from(new Float32Array(vector));
    expect(vectorDistance(vector, stored)).toBeLessThan(0.003);
  });

  test('the candidate radius covers both limits plus the sampling slack', () => {
    const radius = candidateRadiusKm(space, 5 * KM_PER_NM, 1000);
    expect(radius).toBeCloseTo(Math.SQRT2 * 5 * KM_PER_NM + SAMPLING_SLACK_KM, 6);
  });
});
