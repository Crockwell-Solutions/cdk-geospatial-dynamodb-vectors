import { LonLat, decodePolyline, encodePolyline } from './polyline';

describe('encoded polylines', () => {
  test('matches the reference example from the format specification', () => {
    const points: LonLat[] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  test('round-trips coordinates to five decimal places', () => {
    const points: LonLat[] = [
      [-2.07524, 43.15],
      [-1.98133, 43.29111],
      [8.53, 50.15],
      [-4.22, 43.15],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    expect(decoded).toHaveLength(points.length);
    decoded.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(points[i][0], 5);
      expect(lat).toBeCloseTo(points[i][1], 5);
    });
  });

  test('handles an empty track', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });
});
