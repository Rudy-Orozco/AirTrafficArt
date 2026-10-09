import { useState } from 'react'
import { AirTrafficCanvas } from './AirTrafficCanvas'
import { Tracker } from './tracker'
import { useAircraftFeed } from './useAircraftFeed'

export default function App() {
  const [tracker] = useState(() => new Tracker())
  const { count, updatedAt, error } = useAircraftFeed(tracker)

  return (
    <>
      <AirTrafficCanvas tracker={tracker} />
      <footer className="hud">
        {error ? (
          <span className="hud-error">Feed unavailable: {error}</span>
        ) : updatedAt ? (
          <span>
            {count} aircraft · updated {updatedAt.toLocaleTimeString()}
          </span>
        ) : (
          <span>Waiting for data…</span>
        )}
      </footer>
    </>
  )
}
