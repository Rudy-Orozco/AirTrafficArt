import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AIRPORT_PRESET } from '../config/config'
import {
  formatAltimeter,
  formatCeiling,
  formatDewpoint,
  formatTemperature,
  formatVisibility,
  formatWind,
  useMetar,
} from './metar'
import {
  AltimeterIcon,
  DewpointIcon,
  SkyCoverIcon,
  TemperatureIcon,
  VisibilityIcon,
  WindIcon,
} from './MetarIcons'
import './MetarStrip.css'

/** Reports older than this are probably missing an update, so their age is highlighted. */
const STALE_MINUTES = 90

/** Current weather at the airport: decoded readings over the raw METAR, centered above the board. */
export function MetarStrip() {
  const metar = useMetar(AIRPORT_PRESET.icao)
  const now = useMinuteClock()
  if (!metar) return null

  const ageMinutes = Math.max(0, Math.round((now - metar.obsTime * 1000) / 60_000))
  const category = metar.fltCat ?? null

  return (
    <div className="metar">
      <div className="metar-cells">
        {category && (
          <div className={`metar-cat metar-cat--${category.toLowerCase()}`}>
            <span className="metar-dot" />
            {category}
          </div>
        )}
        <Cell icon={<WindIcon {...metar} />} label="Wind" value={formatWind(metar)} />
        <Cell icon={<VisibilityIcon {...metar} />} label="Visibility" value={formatVisibility(metar)} />
        <Cell icon={<SkyCoverIcon {...metar} />} label="Ceiling" value={formatCeiling(metar)} />
        <Cell icon={<TemperatureIcon {...metar} />} label="Temp" value={formatTemperature(metar)} />
        <Cell icon={<DewpointIcon />} label="Dew pt" value={formatDewpoint(metar)} />
        <Cell icon={<AltimeterIcon {...metar} />} label="Altimeter" value={formatAltimeter(metar)} />
      </div>
      <div className="metar-raw">
        <span className="metar-raw-text">{metar.rawOb}</span>
        <span className={`metar-age${ageMinutes > STALE_MINUTES ? ' is-stale' : ''}`}>{ageMinutes} min ago</span>
      </div>
    </div>
  )
}

function Cell({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metar-cell">
      {icon}
      <span className="metar-label">{label}</span>
      <span className="metar-value">{value}</span>
    </div>
  )
}

/** The current time, updated every 30 seconds (enough for a "minutes ago" readout). */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}
