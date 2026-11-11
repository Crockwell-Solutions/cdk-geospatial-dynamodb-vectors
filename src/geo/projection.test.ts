import { projectToKm, unprojectFromKm } from './projection';

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

describe('Lambert-93 projection', () => {
  test('the projection origin maps to (0, 0)', () => {
    const { x, y } = projectToKm(3, 46.5);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  test('matches the published Lambert-93 constants', () => {
    // IGN publishes Ys = 12 655 612.049876 m for the apex of the cone and a false northing of 6 600 000 m
    expect(projectToKm(3, 90).y).toBeCloseTo((12655612.049876 - 6600000) / 1000, 3);
  });

  test('unprojecting reverses projecting', () => {
    for (const [lon, lat] of [
      [2.3522, 48.8566],
      [-4.22, 43.15],
      [8.53, 50.15],
    ]) {
      const { x, y } = projectToKm(lon, lat);
      const back = unprojectFromKm(x, y);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  test('east is positive x and north is positive y', () => {
    expect(projectToKm(4, 46.5).x).toBeGreaterThan(0);
    expect(projectToKm(2, 46.5).x).toBeLessThan(0);
    expect(projectToKm(3, 47.5).y).toBeGreaterThan(0);
    expect(projectToKm(3, 45.5).y).toBeLessThan(0);
  });

  test('grid distance is within 0.5% of great-circle distance across the whole dataset area', () => {
    // Bounding box of the sample data: 4.22°W to 8.53°E, 43.15°N to 50.15°N
    let worst = 0;
    for (let lat = 43.15; lat <= 50.15; lat += 0.5) {
      for (let lon = -4.22; lon <= 8.53; lon += 0.5) {
        for (const [dLon, dLat] of [
          [0.2, 0],
          [0, 0.15],
          [0.15, 0.1],
        ]) {
          const a = projectToKm(lon, lat);
          const b = projectToKm(lon + dLon, lat + dLat);
          const grid = Math.hypot(b.x - a.x, b.y - a.y);
          const sphere = haversineKm(lon, lat, lon + dLon, lat + dLat);
          worst = Math.max(worst, Math.abs(grid - sphere) / sphere);
        }
      }
    }
    expect(worst).toBeLessThan(0.005);
  });
});
