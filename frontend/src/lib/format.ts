export const KM_PER_NM = 1.852

const pad = (value: number): string => String(value).padStart(2, '0')

/** 14:32 */
export function clock(iso: string | number): string {
  const date = new Date(typeof iso === 'number' ? iso * 1000 : iso)
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/** 14:32:07 */
export function clockSeconds(iso: string | number): string {
  const date = new Date(typeof iso === 'number' ? iso * 1000 : iso)
  return `${clock(iso)}:${pad(date.getUTCSeconds())}`
}

/** 1 October 2026 */
export function longDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const feet = (value: number): string => `${Math.round(value).toLocaleString('en-GB')} ft`

/** Altitudes at or above 10,000 ft read naturally as flight levels */
export function altitude(valueFt: number): string {
  return valueFt >= 10000 ? `FL${String(Math.round(valueFt / 100)).padStart(3, '0')}` : feet(valueFt)
}

export function nauticalMiles(value: number): string {
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} NM`
}

export const kilometres = (value: number): string => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} km`

/** 3 min 20 s, 45 s, 1 h 5 min */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = Math.round(seconds % 60)
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const count = (value: number): string => value.toLocaleString('en-GB')

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
