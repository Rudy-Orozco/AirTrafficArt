import type { Aircraft } from './api'
import { AIRPORT_PRESET, FEED, MAP, MOTION } from './config'
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
  /** When the latest report's position was received (same clock as `now`). */
  reportedAt: number
  /** How fast the track is turning, in degrees per millisecond (positive = right), from the last two reports. */
  turnRate: number
  firstSeen: number
  lastSeen: number
  /** Set when the aircraft touches down; it then fades out. */
  landedAt: number | null
  /** Altitude (feet) glides from `altFrom` to `altTo` over the segment, then carries on at `altRate` (feet per ms). */
  altFrom: number | null
  altTo: number | null
  altRate: number

  /** Updated every frame by step(). */
  pos: LatLon
  vel: LatLon
  heading: number
  /** Smoothed altitude in feet, or null if unknown. */
  altitude: number | null
  /** `turnRate` eased over time (degrees per ms, positive = right), so the 3D models roll into and out of turns. */
  turning: number
  lastStep: number
  opacity: number
  trail: LatLon[]
  /** Altitude (feet, or null) at each trail point, for the 3D map. */
  trailAlt: (number | null)[]
  lastTrailAt: number
}

/**
 * Where an aircraft is drawn as it switches between the airborne and ground
 * trackers (takeoff or touchdown), so the other one carries on from there.
 */
export interface Handoff {
  pos: LatLon
  heading: number
  /** Feet above the field. */
  heightFt: number
}

const TRAIL_SAMPLE_MS = 500
/** Time constant for easing the turn rate used to bank the 3D models. */
const TURN_SMOOTHING_MS = 2000
/** How much each new gap between fetches moves the running average (0 to 1). */
const GAP_SMOOTHING = 0.3

/**
 * Turns periodic position snapshots into continuous motion.
 *
 * Each fetch starts a new segment that curves from wherever the plane is drawn
 * to where its reported speed and track say it will be when the next fetch
 * lands. A turning plane (its track changed since the last report) is predicted
 * to keep turning at the same rate, so turns follow arcs rather than being
 * corrected back at every fetch. The curve (a cubic Hermite spline) starts at the plane's current
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
  private segmentMs = FEED.pollMs

  /**
   * `handoff` gives where a just-departed aircraft was drawn on the ground, so
   * it lifts off from there instead of appearing from nowhere.
   */
  ingest(flights: Flight[], now: number, handoff: (hex: string) => Handoff | null = () => null) {
    // Match the segment length to the gap between fetches (pollMs plus however
    // long the request takes) so planes arrive just as the next update lands.
    // Averaging keeps one slow request from stretching or squashing the next segment.
    if (this.lastIngest !== null) {
      const gap = clamp(now - this.lastIngest, FEED.pollMs, FEED.pollMs * 2)
      this.segmentMs += (gap - this.segmentMs) * GAP_SMOOTHING
    }
    this.lastIngest = now
    const segmentMs = this.segmentMs

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

      const ageMs = a.positionAge * 1000
      const reportedAt = now - ageMs
      const turnRate = existing ? turnRateOf(existing, a, reportedAt) : 0
      // Reported positions are already `positionAge` seconds old; aim for where
      // the plane will be at the end of this segment.
      const target = predict(a, turnRate, ageMs + segmentMs)
      // Altitude is extrapolated along the vertical rate the same way.
      const altRate = (a.verticalRate ?? 0) / 60_000
      const altNow = a.altitude === null ? null : a.altitude + altRate * ageMs
      const altTo = altNow === null ? null : altNow + altRate * segmentMs

      if (!existing) {
        const takeoff = handoff(a.hex)
        const pos = takeoff?.pos ?? predict(a, turnRate, ageMs).pos
        this.tracks.set(a.hex, {
          info: a,
          from: pos,
          fromVelocity: target.velocity,
          to: target.pos,
          velocity: target.velocity,
          segmentStart: now,
          segmentMs,
          reportedAt,
          turnRate,
          // Already on screen on the ground, so no fade-in.
          firstSeen: takeoff ? now - MOTION.fadeInMs : now,
          lastSeen: now,
          landedAt: null,
          altFrom: takeoff ? AIRPORT_PRESET.elevationFt + takeoff.heightFt : altNow,
          altTo,
          altRate,
          pos,
          vel: target.velocity,
          heading: takeoff?.heading ?? a.track ?? 0,
          altitude: takeoff ? AIRPORT_PRESET.elevationFt + takeoff.heightFt : altNow,
          turning: 0,
          lastStep: now,
          opacity: 0,
          trail: [],
          trailAlt: [],
          lastTrailAt: now,
        })
        continue
      }

      existing.info = a
      existing.from = existing.pos
      existing.fromVelocity = existing.vel
      existing.to = target.pos
      existing.velocity = target.velocity
      existing.reportedAt = reportedAt
      existing.turnRate = turnRate
      existing.segmentStart = now
      existing.segmentMs = segmentMs
      existing.altFrom = existing.altitude ?? altNow
      existing.altTo = altTo
      existing.altRate = altRate
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
      if (t.altTo === null || t.altFrom === null) t.altitude = t.altTo
      else if (elapsed < t.segmentMs) t.altitude = t.altFrom + (t.altTo - t.altFrom) * (elapsed / t.segmentMs)
      else t.altitude = t.altTo + t.altRate * (elapsed - t.segmentMs)

      // Point the arrow along the curve; keep the last heading if the speed is unknown.
      t.heading = headingOf(t.vel, t.pos.lat) ?? t.info.track ?? t.heading
      // The reported turn rate only changes with each fetch; ease toward it so the bank
      // rolls in and out. (The drawn curve's own turning wobbles too much at segment joins.)
      const dt = now - t.lastStep
      if (dt > 0) t.turning += (t.turnRate - t.turning) * (1 - Math.exp(-dt / TURN_SMOOTHING_MS))
      t.lastStep = now

      const fadeIn = Math.min((now - t.firstSeen) / MOTION.fadeInMs, 1)
      const fadeOut = 1 - clamp((missingFor - MOTION.staleMs) / MOTION.fadeOutMs, 0, 1)
      const landingFade = 1 - landedFor / MOTION.landingFadeMs
      t.opacity = Math.min(fadeIn, fadeOut, landingFade)

      if (now - t.lastTrailAt >= TRAIL_SAMPLE_MS) {
        t.trail.push(t.pos)
        t.trailAlt.push(t.altitude)
        while (t.trail.length > (MAP.trailSeconds * 1000) / TRAIL_SAMPLE_MS) {
          t.trail.shift()
          t.trailAlt.shift()
        }
        t.lastTrailAt = now
      }
    }
  }

  /** Where a just-landed aircraft was drawn, for the ground tracker to carry on from. */
  handoff(hex: string): Handoff | null {
    const t = this.tracks.get(hex)
    if (!t) return null
    const heightFt = t.altitude === null ? 0 : Math.max(t.altitude - AIRPORT_PRESET.elevationFt, 0)
    return { pos: t.pos, heading: t.heading, heightFt }
  }
}

const NM_PER_DEG_LAT = 60
const MS_PER_HOUR = 3_600_000
/** Twice a standard-rate turn (3°/s); anything faster is treated as a bad track report. */
const MAX_TURN_RATE = 6 / 1000
/** Reports closer together than this give too noisy a turn rate. */
const MIN_TURN_SAMPLE_MS = 2000

/**
 * Degrees per millisecond the track turned between the track's previous report
 * and `a`. Keeps the previous rate if no fresh position arrived in between.
 */
function turnRateOf(t: Track, a: Aircraft, reportedAt: number): number {
  const elapsed = reportedAt - t.reportedAt
  if (elapsed < MIN_TURN_SAMPLE_MS) return t.turnRate
  if (a.track === null || t.info.track === null) return 0
  const turned = ((a.track - t.info.track + 540) % 360) - 180
  const rate = turned / elapsed
  return Math.abs(rate) > MAX_TURN_RATE ? 0 : rate
}

/**
 * Where `a` will be `ms` after its report, and its velocity there, if it keeps
 * its ground speed and turns at `turnRate` (degrees per millisecond).
 */
function predict(a: Aircraft, turnRate: number, ms: number): { pos: LatLon; velocity: LatLon } {
  const pos = { lat: a.lat, lon: a.lon }
  if (a.groundSpeed === null || a.track === null) return { pos, velocity: { lat: 0, lon: 0 } }
  const nmPerMs = a.groundSpeed / MS_PER_HOUR
  const start = (a.track * Math.PI) / 180
  const end = ((a.track + turnRate * ms) * Math.PI) / 180
  const turnedRad = end - start
  // Distance covered north and east: along an arc, or straight if barely turning.
  const [north, east] =
    Math.abs(turnedRad) < 1e-6
      ? [nmPerMs * ms * Math.cos(start), nmPerMs * ms * Math.sin(start)]
      : [
          ((nmPerMs * ms) / turnedRad) * (Math.sin(end) - Math.sin(start)),
          ((nmPerMs * ms) / turnedRad) * (Math.cos(start) - Math.cos(end)),
        ]
  const lonScale = NM_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180)
  return {
    pos: { lat: a.lat + north / NM_PER_DEG_LAT, lon: a.lon + east / lonScale },
    velocity: { lat: (nmPerMs * Math.cos(end)) / NM_PER_DEG_LAT, lon: (nmPerMs * Math.sin(end)) / lonScale },
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
