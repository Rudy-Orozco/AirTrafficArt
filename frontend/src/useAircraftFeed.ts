import { useEffect, useState } from 'react'
import { fetchAircraft } from './api'
import { FlightBoard, type BoardState } from './flightBoard'
import { FEED } from './config'
import { FlightClassifier } from './flights'
import { RouteCache } from './routes'
import type { Tracker } from './tracker'

export interface FeedStatus {
  /** Airborne aircraft in range. */
  count: number
  updatedAt: Date | null
  error: string | null
  /** The next scheduled fetch: a unique id and how long until it runs, including any backoff after errors. */
  nextPoll: { id: number; delayMs: number } | null
}

export interface Feed {
  status: FeedStatus
  board: BoardState
}

/**
 * Polls /api/aircraft every FEED.pollMs, looks up each flight's route, and feeds the
 * classified flights to the tracker (map) and the arrivals/departures board.
 */
export function useAircraftFeed(tracker: Tracker): Feed {
  const [feed, setFeed] = useState<Feed>({
    status: { count: 0, updatedAt: null, error: null, nextPoll: null },
    board: { arrivals: [], departures: [], landing: null, takeoff: null },
  })

  useEffect(() => {
    const controller = new AbortController()
    const routes = new RouteCache()
    const classifier = new FlightClassifier()
    const board = new FlightBoard()
    let timer: ReturnType<typeof setTimeout>
    let failures = 0
    let polls = 0

    // Back off on errors (e.g. HTTP 429). Otherwise schedule from when the poll
    // started so latency doesn't stretch the interval.
    const scheduleNext = (started: number) => {
      const interval = Math.min(FEED.pollMs * 2 ** failures, FEED.maxBackoffMs)
      const delay = Math.max(0, interval - (performance.now() - started))
      timer = setTimeout(poll, delay)
      return { id: ++polls, delayMs: delay }
    }

    const poll = async () => {
      const started = performance.now()
      try {
        const aircraft = await fetchAircraft(controller.signal)
        const routeMap = await routes.lookup(aircraft, controller.signal)
        const flights = classifier.classify(aircraft, routeMap)
        tracker.ingest(flights, performance.now())
        failures = 0
        const count = flights.filter((f) => !f.onGround).length
        const nextPoll = scheduleNext(started)
        setFeed({
          status: { count, updatedAt: new Date(), error: null, nextPoll },
          board: board.update(flights, Date.now()),
        })
      } catch (err) {
        if (controller.signal.aborted) return
        failures++
        // Keep the last snapshot on screen; the tracker keeps planes gliding meanwhile.
        const error = err instanceof Error ? err.message : String(err)
        const nextPoll = scheduleNext(started)
        setFeed((f) => ({ ...f, status: { ...f.status, error, nextPoll } }))
      }
    }
    poll()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [tracker])

  return feed
}
