export interface Aircraft {
  hex: string
  callsign: string
  lat: number
  lon: number
  /** Degrees clockwise from true north, or null if unknown. */
  track: number | null
  /** Ground speed in knots, or null if unknown. */
  groundSpeed: number | null
  /** Barometric altitude in feet, or null if unknown. */
  altitude: number | null
  onGround: boolean
  /** Seconds since the position was received, so we can project it to the present. */
  positionAge: number
}

/** One aircraft in readsb's JSON format (used by adsb.lol, readsb, and our backend). */
interface RawAircraft {
  hex: string
  flight?: string
  r?: string
  lat?: number
  lon?: number
  track?: number
  true_heading?: number
  gs?: number
  alt_baro?: number | 'ground'
  seen_pos?: number
}

const REQUEST_TIMEOUT_MS = 10_000

export async function fetchAircraft(signal: AbortSignal): Promise<Aircraft[]> {
  const res = await fetch('/api/aircraft', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  // adsb.lol calls the list "ac"; a local readsb aircraft.json calls it "aircraft".
  const data = (await res.json()) as { ac?: RawAircraft[]; aircraft?: RawAircraft[] }
  const list = data.ac ?? data.aircraft ?? []

  return list
    .filter((a): a is RawAircraft & { lat: number; lon: number } => a.lat != null && a.lon != null)
    .map((a) => ({
      hex: a.hex,
      callsign: (a.flight ?? a.r ?? a.hex).trim(),
      lat: a.lat,
      lon: a.lon,
      track: a.track ?? a.true_heading ?? null,
      groundSpeed: a.gs ?? null,
      altitude: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      onGround: a.alt_baro === 'ground',
      positionAge: a.seen_pos ?? 0,
    }))
}
