// Decoder for the Encoded Polyline Algorithm Format (precision 5).
// The matching encoder lives in src/geo/polyline.ts in the backend.

export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0

  const next = (): number => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    lat += next()
    lon += next()
    points.push([lon / 1e5, lat / 1e5])
  }
  return points
}
