import { useId, useMemo, useRef, useState } from 'react'
import { clock } from '../lib/format'
import type { MapFlight } from '../types'

interface SearchBoxProps {
  flights: MapFlight[]
  onSelect: (flightId: string) => void
}

const MAX_RESULTS = 8

/** Callsign search with type-ahead. Matches at the start of the callsign rank above matches inside it. */
export function SearchBox({ flights, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => {
    const term = query.trim().toUpperCase().replace(/\s+/g, '')
    if (!term) return []
    const starts: MapFlight[] = []
    const contains: MapFlight[] = []
    for (const flight of flights) {
      const position = flight.callsign.indexOf(term)
      if (position === 0) starts.push(flight)
      else if (position > 0 || flight.registration?.replace('-', '').includes(term)) contains.push(flight)
      if (starts.length >= MAX_RESULTS) break
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS)
  }, [flights, query])

  const choose = (flight: MapFlight): void => {
    onSelect(flight.flightId)
    setQuery('')
    setOpen(false)
    input.current?.blur()
  }

  const showList = open && query.trim().length > 0

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search for a flight by callsign
      </label>
      <svg
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3.5 3.5" />
      </svg>
      <input
        ref={input}
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search callsign, e.g. AFR or EZY"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((value) => Math.min(value + 1, results.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((value) => Math.max(value - 1, 0))
          } else if (event.key === 'Enter' && results[active]) {
            choose(results[active])
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="w-full rounded-lg border border-hairline bg-raised py-2 pr-3 pl-9 text-sm text-ink uppercase placeholder:text-muted placeholder:normal-case focus:border-traffic focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          // In the normal flow rather than floating: the panel scrolls, and would clip an overlay
          className="mt-1 w-full overflow-hidden rounded-lg border border-hairline bg-raised py-1"
        >
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No flight matches “{query.trim()}”</li>}
          {results.map((flight, index) => (
            <li
              key={flight.flightId}
              role="option"
              aria-selected={index === active}
              // mousedown rather than click, so the choice lands before the input loses focus
              onMouseDown={(event) => {
                event.preventDefault()
                choose(flight)
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${
                index === active ? 'bg-white/10' : ''
              }`}
            >
              <span className="font-semibold text-ink">{flight.callsign}</span>
              <span className="truncate text-xs text-ink-2">
                {[flight.aircraftType, `${clock(flight.startTime)}–${clock(flight.endTime)}`].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
