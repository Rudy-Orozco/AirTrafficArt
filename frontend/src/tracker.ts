import type { Aircraft } from './api'
import { FEED, MAP, MOTION } from './config'
import { wasLanding, type Flight } from './flights'

export interface LatLon {
  lat: number
  lon: number
}

export interface Track {
  info: Flight
  /** Where the current segment starts (the drawn position when the last fetch landed). */
  from: LatLon
  /** The drawn velocity when the segment started, so the curve continues smoothly from it. */
  fromVelocity: LatLon
  /** Where the plane should be when the next fetch lands, dead-reckoned from its report. */
  to: LatLon
  /** Reported velocity in degrees per millisecond; the segment ends moving at this. */
  velocity: LatLon
  segmentStart: number
  segmentMs: number
  firstSeen: number
  lastSeen: number
  /** Set when the aircraft touches down; it then fades out. */
  landedAt: number | null

  /** Updated every frame by step(). */
  pos: LatLon
  vel: LatLon
  heading: number
  opacity: number
  trail: LatLon[]
  lastTrailAt: number
}

const TRAIL_SAMPLE_MS = 500

/**
 * Turns periodic position snapshots into continuous motion.
 *
 * Each fetch starts a new segment that curves from wherever the plane is drawn
 * to where its reported speed and track say it will be when the next fetch
 * lands. The curve (a cubic Hermite spline) starts at the plane's current
 * velocity and ends at its reported velocity, so position and direction never
 * jump: turns come out as smooth arcs instead of corners. Planes move from the
 * moment they appear and keep gliding along their heading if a fetch fails.
 *
 * Only airborne aircraft are shown: one that lands rolls out and fades away, and
 * one that takes off fades in as it appears.
 */
export class Tracker {
  readonly tracks = new Map<string, Track>()
  private lastIngest: number | null = null

  ingest(flights: Flight[], now: number) {
    // Match the segment length to the real gap between fetches (pollMs plus
    // network latency) so planes arrive just as the next update lands.
    const segmentMs =
      this.lastIngest === null ? FEED.pollMs : clamp(now - this.lastIngest, FEED.pollMs / 2, FEED.pollMs * 2)
    this.lastIngest = now

    const reported = new Set(flights.map((f) => f.hex))
    for (const t of this.tracks.values()) {
      // Low aircraft usually drop out of coverage at touchdown, before reporting "ground".
      if (!reported.has(t.info.hex) && t.landedAt === null && wasLanding(t.info)) t.landedAt = now
    }

    for (const a of flights) {
      const existing = this.tracks.get(a.hex)
      if (a.onGround) {
        if (existing && existing.landedAt === null) existing.landedAt = now
        continue
      }

      const velocity = velocityOf(a)
      // Reported positions are already `positionAge` seconds old; aim for where
      // the plane will be at the end of this segment.
      const position = { lat: a.lat, lon: a.lon }
      const target = advance(position, velocity, a.positionAge * 1000 + segmentMs)

      if (!existing) {
        const pos = advance(position, velocity, a.positionAge * 1000)
        this.tracks.set(a.hex, {
          info: a,
          from: pos,
          fromVelocity: velocity,
          to: target,
          velocity,
          segmentStart: now,
          segmentMs,
          firstSeen: now,
          lastSeen: now,
          landedAt: null,
          pos,
          vel: velocity,
          heading: a.track ?? 0,
          opacity: 0,
          trail: [],
          lastTrailAt: now,
        })
        continue
      }

      existing.info = a
      existing.from = existing.pos
      existing.fromVelocity = existing.vel
      existing.to = target
      existing.velocity = velocity
      existing.segmentStart = now
      existing.segmentMs = segmentMs
      existing.lastSeen = now
      // Touchdown reports can flicker; an airborne report means it's still flying.
      existing.landedAt = null
    }
  }

  /** Advance every track to `now`. Call once per animation frame. */
  step(now: number) {
    for (const [hex, t] of this.tracks) {
      const missingFor = now - t.lastSeen
      const landedFor = t.landedAt === null ? 0 : now - t.landedAt
      if (missingFor > MOTION.staleMs + MOTION.fadeOutMs || landedFor > MOTION.landingFadeMs) {
        this.tracks.delete(hex)
        continue
      }

      const elapsed = now - t.segmentStart
      if (elapsed < t.segmentMs) {
        const u = elapsed / t.segmentMs
        t.pos = {
          lat: hermite(t.from.lat, t.fromVelocity.lat, t.to.lat, t.velocity.lat, t.segmentMs, u),
          lon: hermite(t.from.lon, t.fromVelocity.lon, t.to.lon, t.velocity.lon, t.segmentMs, u),
        }
        t.vel = {
          lat: hermiteSlope(t.from.lat, t.fromVelocity.lat, t.to.lat, t.velocity.lat, t.segmentMs, u),
          lon: hermiteSlope(t.from.lon, t.fromVelocity.lon, t.to.lon, t.velocity.lon, t.segmentMs, u),
        }
      } else {
        // The next fetch is late: keep flying straight at the last known speed.
        t.pos = advance(t.to, t.velocity, elapsed - t.segmentMs)
        t.vel = t.velocity
      }
      // Point the arrow along the curve; keep the last heading if the speed is unknown.
      t.heading = headingOf(t.vel, t.pos.lat) ?? t.info.track ?? t.heading

      const fadeIn = Math.min((now - t.firstSeen) / MOTION.fadeInMs, 1)
      const fadeOut = 1 - clamp((missingFor - MOTION.staleMs) / MOTION.fadeOutMs, 0, 1)
      const landingFade = 1 - landedFor / MOTION.landingFadeMs
      t.opacity = Math.min(fadeIn, fadeOut, landingFade)

      if (now - t.lastTrailAt >= TRAIL_SAMPLE_MS) {
        t.trail.push(t.pos)
        if (t.trail.length > (MAP.trailSeconds * 1000) / TRAIL_SAMPLE_MS) t.trail.shift()
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

/** Compass heading of a velocity, or null if it's not moving. */
function headingOf(v: LatLon, lat: number): number | null {
  const east = v.lon * Math.cos((lat * Math.PI) / 180)
  const north = v.lat
  if (east === 0 && north === 0) return null
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}

function advance(p: LatLon, velocity: LatLon, ms: number): LatLon {
  return { lat: p.lat + velocity.lat * ms, lon: p.lon + velocity.lon * ms }
}

/**
 * Cubic Hermite interpolation from p0 (moving at v0) to p1 (moving at v1) over
 * `duration` ms, evaluated at fraction u in [0, 1].
 */
function hermite(p0: number, v0: number, p1: number, v1: number, duration: number, u: number) {
  const u2 = u * u
  const u3 = u2 * u
  return (
    (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * duration * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * duration * v1
  )
}

/** Rate of change of hermite() per millisecond, i.e. the velocity along the curve. */
function hermiteSlope(p0: number, v0: number, p1: number, v1: number, duration: number, u: number) {
  const u2 = u * u
  return (
    ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * duration * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * duration * v1) /
    duration
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}
