/** Headers returned with every API response */
export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

/** Flight data only changes when the dataset is reloaded, so browsers and CloudFront may cache it briefly */
export const CACHE_SECONDS = {
  manifest: 30,
  flights: 300,
  none: 0,
};
