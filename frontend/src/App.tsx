import { useRef, useState } from 'react'
import { AirportDiorama } from './AirportDiorama'
import { AirTrafficCanvas } from './AirTrafficCanvas'
import { Board } from './Board'
import { DIORAMA } from './config'
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
      <AirTrafficCanvas tracker={tracker} overlay={boardRef} />
      {DIORAMA.enabled && <AirportDiorama tracker={tracker} ground={ground} />}
      <Board board={board} status={status} ref={boardRef} />
      <SettingsPanel />
    </main>
  )
}
