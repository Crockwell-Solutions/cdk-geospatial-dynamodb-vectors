// Browser cache for the full list of flights.
//
// Around 14,000 flight summaries with their tracks come to several megabytes, which is
// too much for localStorage but trivial for IndexedDB. One record is kept, tagged with the
// dataset version from the manifest; reloading the data on the server changes the version
// and so invalidates the cache.

import type { FlightSummary } from '../types'

const DATABASE = 'flight-proximity'
const STORE = 'datasets'
const KEY = 'flights'

interface CachedDataset {
  version: string
  flights: FlightSummary[]
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readCachedFlights(version: string): Promise<FlightSummary[] | undefined> {
  try {
    const database = await open()
    const cached = await new Promise<CachedDataset | undefined>((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve(request.result as CachedDataset | undefined)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return cached?.version === version ? cached.flights : undefined
  } catch {
    // Private browsing, blocked storage, and so on: carry on without a cache
    return undefined
  }
}

export async function writeCachedFlights(version: string, flights: FlightSummary[]): Promise<void> {
  try {
    const database = await open()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put({ version, flights } satisfies CachedDataset, KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  } catch {
    // Caching is a nicety; failing to write is not an error worth surfacing
  }
}
