import { useEffect, useRef, useState } from 'react'
import { AIRPORT, AIRPORT_PRESET } from '../config/config'
import type { BootState, BootStep } from '../feed/useAircraftFeed'

/** How long a step that's taking longer than expected is guessed to still need. */
const OVERRUN_GUESS_MS = 1500
/** How long the screen takes to fade away once aircraft are on screen. */
const FADE_MS = 600

/**
 * Covers the map while the first aircraft are on their way, with each step, a
 * progress bar and the time remaining. In the delayed view that includes waiting
 * for every aircraft's second report, which takes a whole poll.
 */
export function BootScreen({ boot }: { boot: BootState }) {
  const [skipped, setSkipped] = useState(false)
  const [gone, setGone] = useState(false)
  const [shown, setShown] = useState({ fraction: 0, remainingMs: 0 })
  const latest = useRef(boot)
  const hiding = boot.done || skipped

  useEffect(() => {
    latest.current = boot
  }, [boot])

  useEffect(() => {
    if (hiding) {
      const id = setTimeout(() => setGone(true), FADE_MS)
      return () => clearTimeout(id)
    }
    const update = () => {
      const { done, total } = progress(latest.current.steps, performance.now())
      const fraction = total > 0 ? Math.min(done / total, 0.99) : 0
      // The bar never goes backwards, even when a step turns out slower than expected.
      setShown((s) => ({ fraction: Math.max(s.fraction, fraction), remainingMs: Math.max(total - done, 0) }))
    }
    update()
    const id = setInterval(update, 100)
    return () => clearInterval(id)
  }, [hiding])

  if (gone) return null

  const percent = boot.done ? 100 : Math.floor(shown.fraction * 100)
  const remainingS = Math.ceil(shown.remainingMs / 1000)
  // One step per report waited for beyond the first.
  const reports = boot.steps.length - 1
  const delayed = reports >= 2

  return (
    <div className={`boot${hiding ? ' is-hiding' : ''}`}>
      <div className="boot-card">
        <div className="boot-title">
          {AIRPORT} <span className="boot-airport">{AIRPORT_PRESET.name}</span>
        </div>
        <div className="boot-heading">Processing live traffic</div>

        <ol className="boot-steps" aria-live="polite">
          {boot.steps.map((s) => (
            <li key={s.label} className={`boot-step is-${stepState(s)}`}>
              <span className="boot-step-mark" aria-hidden />
              {s.label}
            </li>
          ))}
        </ol>

        <div className="boot-bar" aria-hidden>
          <div className="boot-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="boot-numbers">
          <span>{percent}%</span>
          <span>{remainingText(boot, remainingS)}</span>
        </div>

        {boot.error && <div className="boot-error">Feed unavailable ({boot.error}), retrying</div>}
        {delayed && (
          <p className="boot-note">
            Delayed view: each aircraft appears once it has reported {reports === 3 ? 'three times' : 'twice'}, and the map
            runs about {reports === 3 ? 'two updates' : 'one update'} behind live.
          </p>
        )}
        <button className="boot-skip" onClick={() => setSkipped(true)}>
          Show the map now
        </button>
      </div>
    </div>
  )
}

function remainingText(boot: BootState, remainingS: number) {
  if (boot.done) return 'Ready'
  if (boot.steps.length === 0) return 'Starting'
  if (remainingS <= 1) return 'Almost ready'
  return `About ${remainingS} s remaining`
}

function stepState(s: BootStep) {
  if (s.finishedAt !== null) return 'done'
  if (s.startedAt !== null) return 'active'
  return 'pending'
}

/**
 * Milliseconds of work done and expected in all, from the steps: finished ones
 * count as they actually took, unfinished ones as expected, and one running
 * over its estimate as needing a little longer still.
 */
function progress(steps: BootStep[], now: number) {
  let done = 0
  let total = 0
  for (const s of steps) {
    if (s.finishedAt !== null && s.startedAt !== null) {
      done += s.finishedAt - s.startedAt
      total += s.finishedAt - s.startedAt
    } else if (s.startedAt !== null) {
      const elapsed = now - s.startedAt
      done += elapsed
      total += Math.max(s.expectedMs, elapsed + OVERRUN_GUESS_MS)
    } else {
      total += s.expectedMs
    }
  }
  return { done, total }
}
