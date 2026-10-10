import { useEffect, useState } from 'react'
import { AIRPORT_PRESET, FEED, METAR } from '../config/config'

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR'

/** The fields we use from aviationweather.gov's METAR JSON. */
export interface Metar {
  rawOb: string
  /** Observation time, seconds since the epoch. */
  obsTime: number
  temp: number | null
  dewp: number | null
  /** Degrees, or "VRB" for variable. */
  wdir: number | 'VRB' | null
  wspd: number | null
  wgst?: number | null
  /** Statute miles; "10+" means 10 or more. */
  visib: number | string | null
  /** Hectopascals. */
  altim: number | null
  clouds: { cover: string; base: number | null }[]
  fltCat?: FlightCategory
}

async function fetchMetar(icao: string, signal: AbortSignal): Promise<Metar | null> {
  const res = await fetch(`/api/metar?ids=${icao}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(FEED.requestTimeoutMs)]),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // The last two hours of reports; use the newest.
  const reports: Metar[] = await res.json()
  return reports.reduce<Metar | null>((newest, m) => (!newest || m.obsTime > newest.obsTime ? m : newest), null)
}

/** METARs come hourly; a newest report older than this is likely a stale cached copy. */
const EXPECTED_MAX_AGE_MS = 75 * 60_000
const STALE_RETRY_MS = 60_000

/**
 * The latest METAR for `icao`, refreshed every METAR.refreshMs, or after a
 * minute if the service handed back an out-of-date report (its CDN occasionally
 * serves an old cached copy). Keeps the last report if a refresh fails.
 */
export function useMetar(icao: string): Metar | null {
  const [metar, setMetar] = useState<Metar | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      let delay = METAR.refreshMs
      try {
        const m = await fetchMetar(icao, controller.signal)
        if (m) setMetar((prev) => (prev && prev.obsTime > m.obsTime ? prev : m))
        if (!m || Date.now() - m.obsTime * 1000 > EXPECTED_MAX_AGE_MS) delay = STALE_RETRY_MS
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn('METAR unavailable:', err)
      }
      timer = setTimeout(load, delay)
    }
    load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [icao])

  return metar
}

// ---- Decoding for display ----------------------------------------------------------

const HPA_TO_INHG = 0.02953

export function formatWind({ wdir, wspd, wgst }: Metar) {
  if (wspd === null) return '—'
  if (wspd === 0) return 'CALM'
  const dir = wdir === 'VRB' || wdir === null ? 'VRB' : `${String(wdir).padStart(3, '0')}°`
  return `${dir} ${wspd}${wgst ? `G${wgst}` : ''} KT`
}

export function formatVisibility({ visib }: Metar) {
  return visib === null ? '—' : `${visib} SM`
}

/** The lowest broken, overcast or obscured layer, which is what counts as a ceiling. */
export function formatCeiling({ clouds }: Metar) {
  const ceiling = clouds.find((c) => ['BKN', 'OVC', 'OVX', 'VV'].includes(c.cover) && c.base !== null)
  if (ceiling) return `${ceiling.cover} ${ceiling.base!.toLocaleString()} FT`
  return clouds.length === 0 || clouds[0].cover === 'CLR' || clouds[0].cover === 'SKC' ? 'CLEAR' : 'NONE'
}

export function formatTemperature({ temp }: Metar) {
  return temp === null ? '—' : `${Math.round(temp)}°C`
}

export function formatDewpoint({ dewp }: Metar) {
  return dewp === null ? '—' : `${Math.round(dewp)}°C`
}

/** North America (ICAO K..., C..., P... for Alaska/Hawaii) reports inches of mercury; most of the world hPa. */
const USES_INHG = /^[KCP]/.test(AIRPORT_PRESET.icao)

export function formatAltimeter({ altim }: Metar) {
  if (altim === null) return '—'
  return USES_INHG ? `${(altim * HPA_TO_INHG).toFixed(2)} INHG` : `${Math.round(altim)} HPA`
}
