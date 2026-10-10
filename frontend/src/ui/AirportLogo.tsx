import { useState } from 'react'
import { AIRPORT_PRESET } from '../config/config'

/**
 * The airport's official logo in the top-left corner of the screen, on a white
 * plate since most are drawn for light backgrounds. Nothing if the airport has
 * no logo (AIRPORT_PRESET.logo) or it fails to load.
 */
export function AirportLogo() {
  const [failed, setFailed] = useState(false)
  if (!AIRPORT_PRESET.logo || failed) return null
  return (
    <div className="airport-logo">
      <img src={AIRPORT_PRESET.logo} alt={AIRPORT_PRESET.name} onError={() => setFailed(true)} />
    </div>
  )
}
