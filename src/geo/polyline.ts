/**
 * Encoded Polyline Algorithm Format (the same format used by Google Maps and OSRM).
 *
 * Used to ship every flight track to the browser compactly: a coordinate pair
 * costs around six characters instead of twenty as JSON numbers.
 */

export type LonLat = [lon: number, lat: number];

/** 5 decimal places is about one metre, which matches the precision of the source data */
const FACTOR = 1e5;

function encodeSigned(value: number): string {
  let bits = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (bits >= 0x20) {
    out += String.fromCharCode((0x20 | (bits & 0x1f)) + 63);
    bits >>= 5;
  }
  return out + String.fromCharCode(bits + 63);
}

export function encodePolyline(points: readonly LonLat[]): string {
  let previousLat = 0;
  let previousLon = 0;
  let out = '';
  for (const [lon, lat] of points) {
    const scaledLat = Math.round(lat * FACTOR);
    const scaledLon = Math.round(lon * FACTOR);
    out += encodeSigned(scaledLat - previousLat) + encodeSigned(scaledLon - previousLon);
    previousLat = scaledLat;
    previousLon = scaledLon;
  }
  return out;
}

export function decodePolyline(encoded: string): LonLat[] {
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / FACTOR, lat / FACTOR]);
  }
  return points;
}
