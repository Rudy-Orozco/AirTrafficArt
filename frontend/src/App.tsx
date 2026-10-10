import { useRef, useState } from 'react'
import { AirportDiorama } from './AirportDiorama'
import { AirTraffic3D } from './AirTraffic3D'
import { AirTrafficCanvas } from './AirTrafficCanvas'
import { Board } from './Board'
import { DIORAMA, MAP } from './config'
import { GroundTracker } from './groundTracker'
import { useSettingsVersion } from './settings'
import { SettingsPanel } from './SettingsPanel'
import { Tracker } from './tracker'
import { useAircraftFeed } from './useAircraftFeed'

export default function App() {
  const [tracker] = useState(() => new Tracker())
  const [ground] = useState(() => new GroundTracker())
  const { status, board } = useAircraftFeed(tracker, ground)
  const boardRef = useRef<HTMLElement>(null)
  // Re-render on settings changes so the board and the 3D view toggle pick them up.
  useSettingsVersion()

  return (
    <main className="app">
      {MAP.view === '3d' ? (
        <AirTraffic3D tracker={tracker} overlay={boardRef} />
      ) : (
        <AirTrafficCanvas tracker={tracker} overlay={boardRef} />
      )}
      {DIORAMA.enabled && <AirportDiorama tracker={tracker} ground={ground} />}
      <Board board={board} status={status} ref={boardRef} />
      <SettingsPanel />
    </main>
  )
}
