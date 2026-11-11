/**
 * In-memory implementation of the flight store.
 *
 * Used by the unit tests, the recall evaluation and the local API server
 * (`npm run local-api`), so the whole application can run without AWS.
 *
 * `searchPositions` is an exact nearest-neighbour search over every stored
 * vector. It stands in for the DynamoDB vector index, which is approximate, so
 * results here are a best case for recall.
 */

import { Vector4, VectorSpace, toVector } from '../geo/vector-space';
import { bucketOf } from './keys';
import type {
  DatasetManifest,
  Flight,
  FlightStore,
  FlightSummary,
  Position,
  VectorHit,
  VectorSearchResult,
} from './types';

export class MemoryFlightStore implements FlightStore {
  private readonly flights = new Map<string, Flight>();
  private readonly buckets = new Map<string, FlightSummary[]>();

  // Every position report as parallel arrays, sorted by the time component of its vector
  private readonly count: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly t: Float32Array;
  private readonly owner: Int32Array;
  private readonly positionIndex: Int32Array;
  private readonly flightList: Flight[];
  private readonly space: VectorSpace;

  public searchCount = 0;

  constructor(
    private readonly manifest: DatasetManifest,
    flights: readonly Flight[],
  ) {
    this.space = manifest.vectorSpace;
    this.flightList = [...flights];

    const rows: { vector: Vector4; owner: number; position: number }[] = [];
    this.flightList.forEach((flight, owner) => {
      this.flights.set(flight.summary.flightId, flight);
      const key = `${flight.summary.date}#${bucketOf(flight.summary.startTime)}`;
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key)!.push(flight.summary);
      flight.positions.forEach((position, index) => {
        rows.push({ vector: toVector(this.space, position), owner, position: index });
      });
    });
    rows.sort((a, b) => a.vector[3] - b.vector[3]);

    this.count = rows.length;
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.t = new Float32Array(this.count);
    this.owner = new Int32Array(this.count);
    this.positionIndex = new Int32Array(this.count);
    rows.forEach((row, i) => {
      [this.x[i], this.y[i], this.z[i], this.t[i]] = row.vector;
      this.owner[i] = row.owner;
      this.positionIndex[i] = row.position;
    });
  }

  async getManifest(): Promise<DatasetManifest> {
    return this.manifest;
  }

  async listFlights(date: string, bucket: string): Promise<FlightSummary[]> {
    return this.buckets.get(`${date}#${bucket}`) ?? [];
  }

  async getFlight(flightId: string): Promise<Flight | undefined> {
    return this.flights.get(flightId);
  }

  async getPositions(flightId: string): Promise<Position[]> {
    return this.flights.get(flightId)?.positions ?? [];
  }

  async searchPositions(vector: Vector4, topK: number): Promise<VectorSearchResult> {
    this.searchCount++;
    const [qx, qy, qz, qt] = vector;

    // Exact top-K. The arrays are sorted by time, so walk outwards from the query time
    // and stop in each direction once time alone puts a point beyond the current K-th best.
    const best: { distanceSquared: number; index: number }[] = [];
    let worst = Infinity;
    const consider = (index: number): boolean => {
      const dt = this.t[index] - qt;
      const dt2 = dt * dt;
      if (best.length >= topK && dt2 > worst) return false;
      const dx = this.x[index] - qx;
      const dy = this.y[index] - qy;
      const dz = this.z[index] - qz;
      const distanceSquared = dx * dx + dy * dy + dz * dz + dt2;
      if (best.length < topK || distanceSquared < worst) {
        let at = best.length;
        while (at > 0 && best[at - 1].distanceSquared > distanceSquared) at--;
        best.splice(at, 0, { distanceSquared, index });
        if (best.length > topK) best.pop();
        if (best.length >= topK) worst = best[best.length - 1].distanceSquared;
      }
      return true;
    };

    let right = this.lowerBound(qt);
    let left = right - 1;
    let moreLeft = left >= 0;
    let moreRight = right < this.count;
    while (moreLeft || moreRight) {
      if (moreLeft) moreLeft = consider(left) && --left >= 0;
      if (moreRight) moreRight = consider(right) && ++right < this.count;
    }

    const hits: VectorHit[] = best.map(({ distanceSquared, index }) => {
      const flight = this.flightList[this.owner[index]];
      const { lon, lat, alt, ts } = flight.positions[this.positionIndex[index]];
      return { flightId: flight.summary.flightId, position: { lon, lat, alt, ts }, score: Math.sqrt(distanceSquared) };
    });
    return { hits };
  }

  private lowerBound(time: number): number {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.t[mid] < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
