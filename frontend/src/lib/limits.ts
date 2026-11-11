import type { Limits } from '../types'

/** Slider ranges. The API enforces the same bounds. */
export const LIMIT_RANGE = {
  horizontalNm: { min: 1, max: 20, step: 1 },
  verticalFt: { min: 0, max: 5000, step: 100 },
}

/** Standard en-route separation: the natural starting point */
export const DEFAULT_LIMITS: Limits = { horizontalNm: 5, verticalFt: 1000 }
