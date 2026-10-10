import { useEffect, useState } from 'react'
import { aircraftSource, fetchAircraft } from './api'
import { FlightBoard, type BoardState } from './flightBoard'
import { FEED } from './config'
import { FlightClassifier } from './flights'
import { RouteCache } from './routes'
import type { GroundTracker } from './groundTracker'
import type { Tracker } from './tracker'

export interface FeedStatus {
  /** Airborne aircraft in range. */
  count: number
  updatedAt: Date | null
  error: string | null
  /** The next scheduled fetch: a unique id and how long until it runs, including any backoff after errors. */
  nextPoll: { id: number; delayMs: number } | null
  /** Which network the aircraft came from (adsb.lol, or adsb.fi while adsb.lol is rate-limiting). */
  source: string
}

export interface Feed {
  status: FeedStatus
  board: BoardState
}

/**
 * Polls /api/aircraft every FEED.pollMs, looks up each flight's route, and feeds the
 * classified flights to the tracker (map) and the arrivals/departures board.
 */
export function useAircraftFeed(tracker: Tracker, ground: GroundTracker): Feed {
  const [feed, setFeed] = useState<Feed>({
    status: { count: 0, updatedAt: null, error: null, nextPoll: null, source: aircraftSource() },
    board: { arrivals: [], departures: [], landing: null, takeoff: null },
  })

  useEffect(() => {
    const controller = new AbortController()
    const routes = new RouteCache()
    const classifier = new FlightClassifier()
    const board = new FlightBoard()
    let timer: ReturnType<typeof setTimeout>
    let polls = 0

    // The wait starts once the poll has finished (or failed), so slow responses
    // never bunch requests together.
    const scheduleNext = () => {
      const delay = FEED.pollMs
      timer = setTimeout(poll, delay)
      return { id: ++polls, delayMs: delay }
    }

    const poll = async () => {
      try {
        const aircraft = await fetchAircraft(controller.signal)
        const routeMap = await routes.lookup(aircraft, controller.signal)
        const flights = classifier.classify(aircraft, routeMap)
        const now = performance.now()
        // Each hands aircraft over to the other at takeoff and touchdown, so they carry on from where they were drawn.
        tracker.ingest(flights, now, (hex) => ground.handoff(hex))
        ground.ingest(flights, now, (hex) => tracker.handoff(hex))
        const count = flights.filter((f) => !f.onGround).length
        const nextPoll = scheduleNext()
        setFeed({
          status: { count, updatedAt: new Date(), error: null, nextPoll, source: aircraftSource() },
          board: board.update(flights, Date.now()),
        })
      } catch (err) {
        if (controller.signal.aborted) return
        // Keep the last snapshot on screen; the tracker keeps planes gliding meanwhile.
        const error = err instanceof Error ? err.message : String(err)
        const nextPoll = scheduleNext()
        setFeed((f) => ({ ...f, status: { ...f.status, error, nextPoll } }))
      }
    }
    poll()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [tracker, ground])

  return feed
}
