import { useRef, useState } from 'react'
import { AirTrafficCanvas } from './AirTrafficCanvas'
import { Board } from './Board'
import { Tracker } from './tracker'
import { useAircraftFeed } from './useAircraftFeed'

export default function App() {
  const [tracker] = useState(() => new Tracker())
  const { status, board } = useAircraftFeed(tracker)
  const boardRef = useRef<HTMLElement>(null)

  return (
    <main className="app">
      <AirTrafficCanvas tracker={tracker} overlay={boardRef} />
      <Board board={board} status={status} ref={boardRef} />
    </main>
  )
}
