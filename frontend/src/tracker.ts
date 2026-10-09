import type { Aircraft } from './api'
import { POLL_MS } from './config'

export interface LatLon {
  lat: number
  lon: number
}

export interface Track {
  info: Aircraft
  /** Where the current segment starts (the drawn position when the last fetch landed). */
  from: LatLon
  /** Where the plane should be when the next fetch lands, dead-reckoned from its report. */
  to: LatLon
  /** Degrees per millisecond, used to keep gliding if the next fetch is late. */
  velocity: LatLon
  fromHeading: number
  toHeading: number
  segmentStart: number
  segmentMs: number
  firstSeen: number
  lastSeen: number

  /** Updated every frame by step(). */
  pos: LatLon
  heading: number
  opacity: number
  trail: LatLon[]
  lastTrailAt: number
}

const FADE_IN_MS = 1000
/**
 * Keep dead-reckoning an aircraft for this long after it drops out of the feed
 * (e.g. rate-limited or failed fetches), then fade it out.
 */
const STALE_MS = 30_000
const FADE_OUT_MS = 2000
const TRAIL_SAMPLE_MS = 500
const TRAIL_POINTS = 60

/**
 * Turns 5-second position snapshots into continuous motion.
 *
 * Each fetch starts a new segment that lerps from wherever the plane is
 * currently drawn to where its reported speed and track say it will be when the
 * next fetch lands. Planes never jump, move from the moment they appear, and keep
 * gliding along their heading if a fetch fails.
 */
export class Tracker {
  readonly tracks = new Map<string, Track>()
  private lastIngest: number | null = null

  ingest(aircraft: Aircraft[], now: number) {
    // Match the segment length to the real gap between fetches (POLL_MS plus
    // network latency) so planes arrive just as the next update lands.
    const segmentMs =
      this.lastIngest === null ? POLL_MS : clamp(now - this.lastIngest, POLL_MS / 2, POLL_MS * 2)
    this.lastIngest = now

    for (const a of aircraft) {
      const velocity = velocityOf(a)
      // Reported positions are already `positionAge` seconds old; aim for where
      // the plane will be at the end of this segment.
      const reported = { lat: a.lat, lon: a.lon }
      const target = advance(reported, velocity, a.positionAge * 1000 + segmentMs)
      const existing = this.tracks.get(a.hex)

      if (!existing) {
        const heading = a.track ?? 0
        const pos = advance(reported, velocity, a.positionAge * 1000)
        this.tracks.set(a.hex, {
          info: a,
          from: pos,
          to: target,
          velocity,
          fromHeading: heading,
          toHeading: heading,
          segmentStart: now,
          segmentMs,
          firstSeen: now,
          lastSeen: now,
          pos,
          heading,
          opacity: 0,
          trail: [],
          lastTrailAt: now,
        })
        continue
      }

      existing.info = a
      existing.from = existing.pos
      existing.to = target
      existing.velocity = velocity
      existing.fromHeading = existing.heading
      existing.toHeading = a.track ?? existing.heading
      existing.segmentStart = now
      existing.segmentMs = segmentMs
      existing.lastSeen = now
    }
  }

  /** Advance every track to `now`. Call once per animation frame. */
  step(now: number) {
    for (const [hex, t] of this.tracks) {
      const missingFor = now - t.lastSeen
      if (missingFor > STALE_MS + FADE_OUT_MS) {
        this.tracks.delete(hex)
        continue
      }

      const elapsed = now - t.segmentStart
      if (elapsed <= t.segmentMs) {
        const progress = elapsed / t.segmentMs
        t.pos = {
          lat: lerp(t.from.lat, t.to.lat, progress),
          lon: lerp(t.from.lon, t.to.lon, progress),
        }
        t.heading = lerpAngle(t.fromHeading, t.toHeading, progress)
      } else {
        // The next fetch is late: keep flying straight at the last known speed.
        t.pos = advance(t.to, t.velocity, elapsed - t.segmentMs)
        t.heading = t.toHeading
      }

      const fadeIn = Math.min((now - t.firstSeen) / FADE_IN_MS, 1)
      const fadeOut = 1 - clamp((missingFor - STALE_MS) / FADE_OUT_MS, 0, 1)
      t.opacity = Math.min(fadeIn, fadeOut)

      if (now - t.lastTrailAt >= TRAIL_SAMPLE_MS) {
        t.trail.push(t.pos)
        if (t.trail.length > TRAIL_POINTS) t.trail.shift()
        t.lastTrailAt = now
      }
    }
  }
}

const NM_PER_DEG_LAT = 60
const MS_PER_HOUR = 3_600_000

/** Convert ground speed (knots) and track (degrees) to degrees of lat/lon per millisecond. */
function velocityOf(a: Aircraft): LatLon {
  if (a.groundSpeed === null || a.track === null) return { lat: 0, lon: 0 }
  const nmPerMs = a.groundSpeed / MS_PER_HOUR
  const rad = (a.track * Math.PI) / 180
  return {
    lat: (nmPerMs * Math.cos(rad)) / NM_PER_DEG_LAT,
    lon: (nmPerMs * Math.sin(rad)) / (NM_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180)),
  }
}

function advance(p: LatLon, velocity: LatLon, ms: number): LatLon {
  return { lat: p.lat + velocity.lat * ms, lon: p.lon + velocity.lon * ms }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Interpolate between two compass headings the short way around. */
function lerpAngle(a: number, b: number, t: number) {
  const delta = ((b - a + 540) % 360) - 180
  return (a + delta * t + 360) % 360
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}
