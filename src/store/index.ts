import { DynamoFlightStore } from './dynamo-flight-store';
import type { FlightStore } from './types';

export * from './types';
export { DynamoFlightStore } from './dynamo-flight-store';

let store: FlightStore | undefined;

/** The store used by the Lambda handlers, created once per execution environment */
export function flightStore(): FlightStore {
  store ??= new DynamoFlightStore(process.env.TABLE_NAME!);
  return store;
}

/** Swaps in a different store. Used by the tests and by the local API server. */
export function setFlightStore(replacement: FlightStore | undefined): void {
  store = replacement;
}
