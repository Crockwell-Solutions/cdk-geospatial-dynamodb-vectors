/**
 * Lambert-93 (EPSG:2154) forward projection.
 *
 * A vector index measures straight-line distance between lists of numbers, so
 * before a position can be indexed, longitude and latitude have to become
 * coordinates on a flat grid where one unit means the same distance in every
 * direction. Raw degrees do not qualify: over France one degree of longitude is
 * roughly 70 km while one degree of latitude is roughly 111 km.
 *
 * Lambert-93 is the official conformal conic projection for metropolitan
 * France. Across the area covered by the sample data its scale error stays
 * below 0.3%, which means Euclidean distance on the grid is, for our purposes,
 * real distance over the ground.
 *
 * Coordinates are returned in kilometres relative to the projection origin
 * (3°E, 46.5°N, roughly the centre of France) rather than with the standard
 * false easting/northing. Small numbers keep the full precision of the 32-bit
 * floats that the vector index stores.
 *
 * For a dataset that spans the globe, swap this for earth-centred (ECEF)
 * coordinates instead of a regional projection.
 */

const DEGREES = Math.PI / 180;

// GRS80 ellipsoid
const SEMI_MAJOR_AXIS_M = 6378137.0;
const FLATTENING = 1 / 298.257222101;
const ECCENTRICITY = Math.sqrt(2 * FLATTENING - FLATTENING * FLATTENING);

// Lambert-93 definition: two standard parallels and an origin
const STANDARD_PARALLEL_1 = 44 * DEGREES;
const STANDARD_PARALLEL_2 = 49 * DEGREES;
const ORIGIN_LATITUDE = 46.5 * DEGREES;
const ORIGIN_LONGITUDE = 3 * DEGREES;

const m = (phi: number): number => Math.cos(phi) / Math.sqrt(1 - ECCENTRICITY ** 2 * Math.sin(phi) ** 2);

const t = (phi: number): number =>
  Math.tan(Math.PI / 4 - phi / 2) /
  Math.pow((1 - ECCENTRICITY * Math.sin(phi)) / (1 + ECCENTRICITY * Math.sin(phi)), ECCENTRICITY / 2);

/** Cone constant (0.7256077650...) */
const N =
  (Math.log(m(STANDARD_PARALLEL_1)) - Math.log(m(STANDARD_PARALLEL_2))) /
  (Math.log(t(STANDARD_PARALLEL_1)) - Math.log(t(STANDARD_PARALLEL_2)));

const F = m(STANDARD_PARALLEL_1) / (N * Math.pow(t(STANDARD_PARALLEL_1), N));

const radiusAt = (phi: number): number => SEMI_MAJOR_AXIS_M * F * Math.pow(t(phi), N);

const ORIGIN_RADIUS_M = radiusAt(ORIGIN_LATITUDE);

export interface PlanarPoint {
  /** Kilometres east of 3°E */
  x: number;
  /** Kilometres north of 46.5°N */
  y: number;
}

/** Projects a WGS84 longitude/latitude (degrees) onto the Lambert-93 grid, in kilometres from its origin. */
export function projectToKm(lon: number, lat: number): PlanarPoint {
  const radius = radiusAt(lat * DEGREES);
  const theta = N * (lon * DEGREES - ORIGIN_LONGITUDE);
  return {
    x: (radius * Math.sin(theta)) / 1000,
    y: (ORIGIN_RADIUS_M - radius * Math.cos(theta)) / 1000,
  };
}

/** The inverse: grid kilometres back to WGS84 longitude/latitude in degrees. */
export function unprojectFromKm(x: number, y: number): { lon: number; lat: number } {
  const dx = x * 1000;
  const dy = ORIGIN_RADIUS_M - y * 1000;
  const radius = Math.hypot(dx, dy);
  const theta = Math.atan2(dx, dy);
  const tValue = Math.pow(radius / (SEMI_MAJOR_AXIS_M * F), 1 / N);

  // Latitude has no closed form on the ellipsoid; this converges in a handful of iterations
  let phi = Math.PI / 2 - 2 * Math.atan(tValue);
  for (let i = 0; i < 8; i++) {
    const eSin = ECCENTRICITY * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tValue * Math.pow((1 - eSin) / (1 + eSin), ECCENTRICITY / 2));
  }
  return { lon: (theta / N + ORIGIN_LONGITUDE) / DEGREES, lat: phi / DEGREES };
}
