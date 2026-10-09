/**
 * All the tunable settings in one place. Edit and save: the dev server reloads
 * instantly. For the Pi, rebuild with `npm run build`.
 *
 * Airports and their map positions are in frontend/airports.json; the default
 * airport is set in frontend/.env.
 */

import airports from '../airports.json'

// ---- Airport -------------------------------------------------------------------

export interface AirportPreset {
  name: string
  /** ICAO code, used for the weather report (METAR). */
  icao: string
  lat: number
  lon: number
  /** Nautical miles from the airport to the nearer edge of the visible map. */
  radiusNm: number
}

const PRESETS: Record<string, AirportPreset> = airports

/** Chosen by ?airport=LAX in the URL, else VITE_AIRPORT in .env. */
function selectAirport(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('airport')
  const requested = (fromUrl ?? import.meta.env.VITE_AIRPORT ?? 'DFW').toUpperCase()
  if (requested in PRESETS) return requested
  console.warn(`No preset for airport "${requested}" in airports.json; showing DFW.`)
  return 'DFW'
}

/** IATA code of the airport whose arrivals and departures are highlighted. */
export const AIRPORT = selectAirport()
export const AIRPORT_PRESET = PRESETS[AIRPORT]

export const CENTER = { lat: AIRPORT_PRESET.lat, lon: AIRPORT_PRESET.lon }

/** Nautical miles from the center to the edge of the map's shorter side. */
export const VIEW_RADIUS_NM = AIRPORT_PRESET.radiusNm

/**
 * A 9:16 portrait screen's half-diagonal is ~2.04x half its short side, so fetch
 * a wider radius than we display to fill the corners.
 */
export const FETCH_RADIUS_NM = Math.ceil(VIEW_RADIUS_NM * 2.1)

// ---- Live data --------------------------------------------------------------

export const FEED = {
  /** How often to fetch aircraft positions. adsb.lol often rate-limits (HTTP 429) anything faster than ~10s. */
  pollMs: 10_000,
  /** When fetches keep failing, the wait between retries doubles up to this. */
  maxBackoffMs: 60_000,
  /** Give up on a single fetch after this long. */
  requestTimeoutMs: 10_000,
  /** How long to remember a flight's origin/destination before looking it up again. */
  routeCacheMs: 60 * 60_000,
}

// ---- Aircraft on the map ----------------------------------------------------

export const MOTION = {
  /** How long a newly seen (or just took off) aircraft takes to fade in. */
  fadeInMs: 1000,
  /** Keep gliding an aircraft along its last heading this long after it drops out of the feed... */
  staleMs: 30_000,
  /** ...then fade it out over this long. */
  fadeOutMs: 2000,
  /** How long an aircraft takes to fade away after it lands. */
  landingFadeMs: 4000,
  /** An aircraft that vanishes from the feed below this altitude (feet) is assumed to have landed. */
  landingAltitudeFt: 2000,
}

export const MAP = {
  departureColor: '#ff8a33',
  arrivalColor: '#4ea2ff',
  /** Aircraft that are neither arriving at nor departing from AIRPORT. */
  otherColor: '#ffffff',
  otherOpacity: 0.3,

  /** Size of the aircraft arrows, in pixels. */
  planeSize: 9,
  /** Show callsign + altitude (hundreds of feet) next to each aircraft. */
  showLabels: true,
  labelSize: 12,
  /**
   * Labels move to a free spot around their aircraft. If none is free right next
   * to it, they sit this many pixels farther out with a leader line back to it.
   */
  labelLeaderLength: 28,
  /** Hide labels of background (white) traffic when there's no free spot; arrivals/departures always show. */
  hideCrowdedLabels: true,
  /** Font for map labels; JetBrains Mono is bundled with the app (the board uses it too). */
  fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',

  /** How many seconds of path each aircraft leaves behind. */
  trailSeconds: 180,
  trailWidth: 1.5,
  /** Opacity of the trail at the aircraft end; it fades to nothing at the tail. */
  trailOpacity: 0.55,

  /** Distance between the range rings, in nautical miles. */
  ringSpacingNm: 10,
}

// ---- Weather (METAR) --------------------------------------------------------------

export const METAR = {
  /** METARs are issued hourly (plus specials when weather changes); checking every 5 minutes catches both. */
  refreshMs: 5 * 60_000,
}

// ---- Arrivals / departures board ---------------------------------------------

export const BOARD = {
  rowsPerPage: 7,
  /** How long each page stays up before flipping to the next. */
  pageMs: 8000,
  /** Keep landed flights on the arrivals board this long, like a real airport board. */
  landedLingerMs: 3 * 60_000,
  /** How long a flight that just landed / took off is announced in its board's header (unless a newer one replaces it). */
  eventMs: 15_000,
  /** Arrivals closer than this (nautical miles) show "Approach" instead of "En route". */
  approachNm: 12,
  /**
   * Departures appear on the board while still on the ground within this many nm
   * of the airport (from when their transponder comes on, usually at pushback).
   */
  groundDepartureNm: 4,
  /** Departures below this altitude (feet) show "Climbing", above it "Departed". */
  climbingBelowFt: 10_000,
  /** Show times as 15:39 instead of 3:39 PM (leaves more room for city names). */
  use24Hour: false,

  /** Split-flap animation: how each changed character flips into place. */
  flip: {
    /** Duration of a single flap. */
    stepMs: 55,
    /** Each changed character flips through this many random characters (picked at random in range)... */
    minSteps: 2,
    maxSteps: 7,
    /** ...starting this much later than the character to its left... */
    charStaggerMs: 14,
    /** ...and this much later than the row above, so changes cascade down the board. */
    rowStaggerMs: 70,
  },
}
