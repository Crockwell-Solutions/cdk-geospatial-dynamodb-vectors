import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl'
// MapLibre finds its worker script relative to its own module URL, which no longer holds once a
// bundler has moved things around. Let Vite build the worker as its own chunk and hand over the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { clock, nauticalMiles, feet } from '../lib/format'
import type { Encounter, FlightDetail, MapFlight } from '../types'

export interface Insets {
  left: number
  right: number
  bottom: number
}

interface MapViewProps {
  flights: MapFlight[]
  selected: FlightDetail | null
  encounters: Encounter[]
  focusedEncounter: string | null
  /** Pixels of the map covered by panels, so that whatever is being shown stays clear of them */
  insets: Insets
  onSelect: (flightId: string) => void
  onFocusEncounter: (flightId: string | null) => void
  onReady: () => void
}

setWorkerUrl(workerUrl)

const COLOURS = {
  surface: '#0b0f14',
  ink: '#f0efec',
  label: '#c3c2b7',
  traffic: '#3987e5',
  own: '#d95926',
  other: '#199e70',
}

/**
 * Basemap: the OpenFreeMap dark style. Free vector tiles built from OpenStreetMap, with no
 * API key or account. If it cannot be reached the map falls back to a plain dark background,
 * so the flight tracks always render.
 */
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

/** Data layers go beneath the basemap's place names, so city labels stay readable over the tracks */
const FIRST_LABEL_LAYER = 'place_other'

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': COLOURS.surface } }],
}

async function loadBasemapStyle(): Promise<StyleSpecification> {
  try {
    const response = await fetch(BASEMAP_STYLE_URL, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Basemap style returned ${response.status}`)
    const style = (await response.json()) as StyleSpecification
    // The style declares a shaded-relief raster source that none of its layers use
    delete style.sources.ne2_shaded
    // Place names sit above the flight tracks, so lift them enough to read against the traffic
    for (const layer of style.layers) {
      if (layer.type === 'symbol' && layer.id.startsWith('place_')) {
        layer.paint = {
          ...layer.paint,
          'text-color': COLOURS.label,
          'text-halo-color': 'rgba(11, 15, 20, 0.85)',
          'text-halo-width': 1.4,
        }
      }
    }
    return style
  } catch (error) {
    console.warn('Basemap unavailable, continuing without it.', error)
    return FALLBACK_STYLE
  }
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Mainland France, the extent of the sample data */
const HOME_BOUNDS: [[number, number], [number, number]] = [
  [-4.6, 42.6],
  [8.9, 50.6],
]

const byZoom = (low: number, high: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  low,
  10,
  high,
]

/** Opacity of the all-flights layer: faint enough that 14,000 overlapping tracks read as density, not a solid fill */
const TRAFFIC_OPACITY = { normal: byZoom(0.04, 0.5), dimmed: byZoom(0.02, 0.14) }

const DATA_SOURCES = ['flights', 'encounters', 'selected', 'reports', 'approaches'] as const

const DATA_LAYERS: LayerSpecification[] = [
  // Every flight. Thin and translucent, so that busy routes build up into brighter corridors.
  {
    id: 'flights',
    type: 'line',
    source: 'flights',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COLOURS.traffic, 'line-width': byZoom(0.5, 1.5), 'line-opacity': TRAFFIC_OPACITY.normal },
  },

  // Flights that came close to the selected one
  {
    id: 'encounters-glow',
    type: 'line',
    source: 'encounters',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COLOURS.other, 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.4 },
  },
  {
    id: 'encounters',
    type: 'line',
    source: 'encounters',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COLOURS.other,
      'line-width': ['case', ['boolean', ['get', 'focused'], false], 3.5, 2],
      'line-opacity': ['case', ['boolean', ['get', 'dimmed'], false], 0.45, 1],
    },
  },

  // The selected flight, drawn from its full position reports
  {
    id: 'selected-glow',
    type: 'line',
    source: 'selected',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COLOURS.own, 'line-width': 12, 'line-blur': 9, 'line-opacity': 0.45 },
  },
  {
    id: 'selected',
    type: 'line',
    source: 'selected',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COLOURS.own, 'line-width': 3 },
  },
  {
    id: 'reports',
    type: 'circle',
    source: 'reports',
    minzoom: 6.5,
    paint: {
      'circle-radius': byZoom(1.5, 4),
      'circle-color': COLOURS.ink,
      'circle-stroke-color': COLOURS.own,
      'circle-stroke-width': 1.5,
    },
  },

  // Closest approach: a connector between the two aircraft, with a dot on each
  {
    id: 'approach-lines',
    type: 'line',
    source: 'approaches',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': COLOURS.ink, 'line-width': 1.5, 'line-dasharray': [1.5, 1.5] },
  },
  {
    id: 'approach-points',
    type: 'circle',
    source: 'approaches',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': ['match', ['get', 'role'], 'own', COLOURS.own, COLOURS.other],
      'circle-stroke-color': COLOURS.surface,
      'circle-stroke-width': 2,
    },
  },
]

function addDataLayers(map: MapLibreMap): void {
  for (const source of DATA_SOURCES) map.addSource(source, { type: 'geojson', data: EMPTY })
  const before = map.getLayer(FIRST_LABEL_LAYER) ? FIRST_LABEL_LAYER : undefined
  for (const layer of DATA_LAYERS) map.addLayer(layer, before)
}

const flightFeatures = (flights: readonly MapFlight[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: flights.map((flight) => ({
    type: 'Feature',
    properties: { id: flight.flightId },
    geometry: { type: 'MultiLineString', coordinates: flight.lines },
  })),
})

function selectedFeatures(flight: FlightDetail): { track: FeatureCollection; reports: FeatureCollection } {
  const segments = new Map<number, [number, number][]>()
  for (const { seg, lon, lat } of flight.positions) {
    if (!segments.has(seg)) segments.set(seg, [])
    segments.get(seg)!.push([lon, lat])
  }
  return {
    track: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates: [...segments.values()].filter((line) => line.length > 1) },
        },
      ],
    },
    reports: {
      type: 'FeatureCollection',
      features: flight.positions.map(({ lon, lat }) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [lon, lat] },
      })),
    },
  }
}

function approachFeatures(encounters: readonly Encounter[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: encounters.flatMap(({ flightId, own, other }): Feature[] => [
      {
        type: 'Feature',
        properties: { id: flightId },
        geometry: {
          type: 'LineString',
          coordinates: [
            [own.lon, own.lat],
            [other.lon, other.lat],
          ],
        },
      },
      { type: 'Feature', properties: { id: flightId, role: 'own' }, geometry: { type: 'Point', coordinates: [own.lon, own.lat] } },
      {
        type: 'Feature',
        properties: { id: flightId, role: 'other' },
        geometry: { type: 'Point', coordinates: [other.lon, other.lat] },
      },
    ]),
  }
}

const setData = (map: MapLibreMap, source: string, data: FeatureCollection): void => {
  void map.getSource<GeoJSONSource>(source)?.setData(data)
}

/** Padding for fitBounds: the panel insets plus a margin that shrinks on small screens */
function paddingFor(map: MapLibreMap, insets: Insets, margin: number) {
  const { width, height } = map.getContainer().getBoundingClientRect()
  const usable = Math.min(width - insets.left - insets.right, height - insets.bottom)
  const space = Math.max(16, Math.min(margin, Math.round(usable * 0.2)))
  return { left: insets.left + space, right: insets.right + space, top: space, bottom: insets.bottom + space }
}

export function MapView({
  flights,
  selected,
  encounters,
  focusedEncounter,
  insets,
  onSelect,
  onFocusEncounter,
  onReady,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Latest values for use inside map event handlers, which are registered once
  const latest = useRef({ flights, onSelect, onFocusEncounter, onReady, insets })
  useEffect(() => {
    latest.current = { flights, onSelect, onFocusEncounter, onReady, insets }
  })
  const flightsById = useRef(new Map<string, MapFlight>())

  // Create the map once
  useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | undefined

    void loadBasemapStyle().then((style) => {
      if (cancelled) return
      map = new MapLibreMap({
        container: container.current!,
        style,
        bounds: HOME_BOUNDS,
        fitBoundsOptions: {
          padding: {
            left: latest.current.insets.left + 24,
            right: 24,
            top: 24,
            bottom: latest.current.insets.bottom + 24,
          },
        },
        minZoom: 3.5,
        maxZoom: 14,
        maxBounds: [
          [-30, 28],
          [35, 64],
        ],
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      })
      const created = map
      created.touchZoomRotate.disableRotation()
      created.addControl(new AttributionControl({ compact: true }), 'bottom-right')
      created.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
      mapRef.current = created

      created.on('load', () => {
        addDataLayers(created)
        setLoaded(true)
      })

      // Click a flight track to select it. A small box around the pointer makes thin lines easy to hit.
      // There is deliberately no hover feedback: hit-testing every track on each pointer move is too
      // much work with the whole dataset on screen, so the map is only queried when it is clicked.
      created.on('click', (event) => {
        if (!created.getLayer('flights')) return
        const { x, y } = event.point
        const [feature] = created.queryRenderedFeatures(
          [
            [x - 5, y - 5],
            [x + 5, y + 5],
          ],
          { layers: ['flights'] },
        )
        if (feature) latest.current.onSelect(feature.properties.id as string)
      })
    })

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [])

  // All flights
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    flightsById.current = new Map(flights.map((flight) => [flight.flightId, flight]))
    setData(map, 'flights', flightFeatures(flights))
    // Tell the app once the tracks have actually been drawn
    void map.once('idle').then(() => latest.current.onReady())
  }, [flights, loaded])

  // Selected flight: draw it, fade everything else, and bring it into view
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    map.setPaintProperty('flights', 'line-opacity', selected ? TRAFFIC_OPACITY.dimmed : TRAFFIC_OPACITY.normal)
    if (!selected) {
      setData(map, 'selected', EMPTY)
      setData(map, 'reports', EMPTY)
      return
    }

    const { track, reports } = selectedFeatures(selected)
    setData(map, 'selected', track)
    setData(map, 'reports', reports)

    const bounds = new LngLatBounds()
    for (const { lon, lat } of selected.positions) bounds.extend([lon, lat])
    map.fitBounds(bounds, { padding: paddingFor(map, latest.current.insets, 90), maxZoom: 9, duration: 900 })
  }, [selected, loaded])

  // Encounters: highlight the other flights and mark each closest approach
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    const others = encounters
      .map(({ flightId }) => flightsById.current.get(flightId))
      .filter((flight): flight is MapFlight => flight !== undefined)
    setData(map, 'encounters', {
      type: 'FeatureCollection',
      features: others.map((flight) => ({
        type: 'Feature',
        properties: {
          id: flight.flightId,
          focused: flight.flightId === focusedEncounter,
          dimmed: focusedEncounter !== null && flight.flightId !== focusedEncounter,
        },
        geometry: { type: 'MultiLineString', coordinates: flight.lines },
      })),
    })
    setData(map, 'approaches', approachFeatures(encounters))

    const markers = encounters.map((encounter) => {
      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'approach-label'
      label.dataset.focused = String(encounter.flightId === focusedEncounter)
      label.append(nauticalMiles(encounter.horizontalNm))
      const vertical = document.createElement('span')
      vertical.textContent = feet(encounter.verticalFt)
      label.append(vertical)
      label.title = `${encounter.callsign} at ${clock(encounter.time)} UTC`
      label.addEventListener('click', (event) => {
        event.stopPropagation()
        latest.current.onFocusEncounter(encounter.flightId)
      })
      return new Marker({ element: label, anchor: 'bottom' })
        .setLngLat([(encounter.own.lon + encounter.other.lon) / 2, (encounter.own.lat + encounter.other.lat) / 2])
        .addTo(map)
    })
    return () => markers.forEach((marker) => marker.remove())
  }, [encounters, focusedEncounter, loaded, flights])

  // Zoom to an encounter when it is chosen from the list or the map
  useEffect(() => {
    const map = mapRef.current
    const encounter = encounters.find(({ flightId }) => flightId === focusedEncounter)
    if (!map || !loaded || !encounter) return
    const bounds = new LngLatBounds()
      .extend([encounter.own.lon, encounter.own.lat])
      .extend([encounter.other.lon, encounter.other.lat])
    map.fitBounds(bounds, { padding: paddingFor(map, latest.current.insets, 200), maxZoom: 9.5, duration: 900 })
  }, [focusedEncounter, encounters, loaded])

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  )
}
