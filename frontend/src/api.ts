import { CENTER, FEED, FETCH_RADIUS_NM } from './config'

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
  /** Feet per minute, positive when climbing, or null if unknown. */
  verticalRate: number | null
  /** ICAO type designator such as B738, or null if unknown. */
  aircraftType: string | null
  /** Seconds since the position was received, so we can project it to the present. */
  positionAge: number
  /** ADS-B emitter category: A1 light, A2 small, A3 large, A5 heavy, A7 rotorcraft... or null if not sent. */
  emitterCategory: string | null
  /** Airport service and emergency vehicles also broadcast ADS-B (emitter category C1-C3). */
  isVehicle: boolean
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
  baro_rate?: number
  geom_rate?: number
  t?: string
  seen_pos?: number
  category?: string
}

export async function fetchAircraft(signal: AbortSignal): Promise<Aircraft[]> {
  const query = new URLSearchParams({ lat: `${CENTER.lat}`, lon: `${CENTER.lon}`, radius: `${FETCH_RADIUS_NM}` })
  const res = await fetch(`/api/aircraft?${query}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(FEED.requestTimeoutMs)]),
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
      verticalRate: a.baro_rate ?? a.geom_rate ?? null,
      aircraftType: a.t ?? null,
      positionAge: a.seen_pos ?? 0,
      emitterCategory: a.category ?? null,
      isVehicle: a.category?.startsWith('C') ?? false,
    }))
}
