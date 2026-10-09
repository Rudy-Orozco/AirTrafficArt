import { useEffect, useState } from 'react'
import { fetchAircraft } from './api'
import { POLL_MS } from './config'
import type { Tracker } from './tracker'

const MAX_BACKOFF_MS = 60_000

export interface FeedStatus {
  count: number
  updatedAt: Date | null
  error: string | null
}

/** Polls /api/aircraft every POLL_MS and feeds each snapshot into the tracker. */
export function useAircraftFeed(tracker: Tracker): FeedStatus {
  const [status, setStatus] = useState<FeedStatus>({ count: 0, updatedAt: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let failures = 0

    const poll = async () => {
      const started = performance.now()
      try {
        const aircraft = await fetchAircraft(controller.signal)
        tracker.ingest(aircraft, performance.now())
        failures = 0
        setStatus({ count: aircraft.length, updatedAt: new Date(), error: null })
      } catch (err) {
        if (controller.signal.aborted) return
        failures++
        // Keep the last snapshot on screen; the tracker keeps planes gliding meanwhile.
        setStatus((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      }
      // Back off on errors (e.g. HTTP 429). Otherwise schedule from when this
      // poll started so latency doesn't stretch the interval.
      const interval = Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS)
      timer = setTimeout(poll, Math.max(0, interval - (performance.now() - started)))
    }
    poll()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [tracker])

  return status
}
