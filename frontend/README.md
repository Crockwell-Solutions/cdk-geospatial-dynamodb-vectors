# Flight Proximity frontend

The map application for the [4D flight proximity demo](../README.md): React 19, TypeScript, Vite, Tailwind CSS 4 and
MapLibre GL JS.

## Running it

The frontend talks to the flights API on its own origin, under `/api`. In development Vite proxies that path, by
default to the local API on port 3001.

```bash
# Terminal 1, from the project root: serve the API from memory, no AWS needed
npm run local-api

# Terminal 2, from the project root (or `npm run dev` in this folder)
npm run frontend
```

To develop against a deployed stack instead, point the proxy at its CloudFront URL:

```bash
API_PROXY_TARGET=https://dxxxxxxxxxxxx.cloudfront.net npm run dev
```

`npm run build` type-checks and produces a production build in `dist/`; `npm run lint` runs ESLint. The CDK frontend
stack runs the build for you when you deploy.

## How it fits together

| File | What it does |
|---|---|
| `src/App.tsx` | Application state: selected flight, limits, analysis result. Mirrors them to the URL so a view can be shared. |
| `src/lib/useFlights.ts` | Loads the manifest, then all flights: from IndexedDB when the cached version matches, otherwise 24 hourly buckets in parallel with progress. |
| `src/lib/cache.ts` | The IndexedDB cache, keyed by the dataset version in the manifest. |
| `src/lib/api.ts` | The four API calls. |
| `src/components/MapView.tsx` | The MapLibre map: every track, the selected flight, flights that came close, and a marker at each closest approach. |
| `src/components/LoadingScreen.tsx` | Shown until the flights are loaded and the map has drawn. |
| `src/components/SearchBox.tsx` | Callsign search with type-ahead. |
| `src/components/FlightCard.tsx`, `AltitudeProfile.tsx` | The selected flight, its altitude profile, and a table of its position reports with their 4D vectors. |
| `src/components/ProximityControls.tsx` | The two sliders that define "close", and the Analyse button. |
| `src/components/Results.tsx` | The flights that came close, and how the search found them. |

## Basemap

The basemap is the [OpenFreeMap](https://openfreemap.org) dark style: free vector tiles built from OpenStreetMap,
with no API key or account. If it cannot be reached the map falls back to a plain background and everything else
keeps working. To use a different basemap, change `BASEMAP_STYLE_URL` in `src/components/MapView.tsx` and the matching
host in the Content Security Policy in `lib/frontend/frontend-stack.ts`.

## Colours

The three data colours (all flights, the selected flight, flights that came close) are a set checked for
colour-blind safety against the dark map: every pair stays distinguishable under protanopia and deuteranopia. They
are defined once in `src/index.css` and mirrored in `MapView.tsx`, because MapLibre paint properties cannot read CSS
variables.
