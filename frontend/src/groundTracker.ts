import { DIORAMA, FEED, MOTION } from './config'
import type { Flight } from './flights'
import { overdueFor, type Handoff, type LatLon } from './tracker'

export interface GroundTrack {
  info: Flight
  /** The drawn position glides from `from` to the latest reported position over one fetch. */
  from: LatLon
  to: LatLon
  fromHeading: number
  toHeading: number
  segmentStart: number
  segmentMs: number
  firstSeen: number
  lastSeen: number
  /** Height above the field (feet), gliding from `fromHeightFt` to 0 over the segment: just touched down. */
  fromHeightFt: number
  /** Whether the current target was predicted ahead (takeoff or landing roll). */
  predicted: boolean
  /** When it last stopped moving, or null while it's moving. */
  stoppedSince: number | null
  parked: boolean

  /** Updated every frame by step(). */
  pos: LatLon
  heading: number
  heightFt: number
  opacity: number
}

/**
 * Aircraft on the ground at the airport, for the 3D airport view.
 *
 * Taxi routes turn sharply at every intersection, so rather than predict ahead
 * (which cuts corners) each taxiing aircraft glides between its last two
 * reported positions, running one fetch behind. Takeoff and landing rolls are
 * fast and straight, so those are predicted ahead instead. Aircraft that sit still count as parked
 * and stay on screen for hours after they vanish from the feed, because most
 * switch their transponders off at the gate.
 *
 * An aircraft that just landed carries on from where the airborne tracker drew
 * it, still in the air, and settles onto the runway over its first segment.
 */
export class GroundTracker {
  readonly tracks = new Map<string, GroundTrack>()
  private lastIngest: number | null = null
  /** Running average of the time between updates (for how long to keep missing aircraft). */
  private gapMs = FEED.pollMs

  /** `handoff` gives where a just-landed aircraft was drawn in the air. */
  ingest(flights: Flight[], now: number, handoff: (hex: string) => Handoff | null = () => null) {
    const segmentMs = this.lastIngest === null ? 0 : Math.min(now - this.lastIngest, FEED.pollMs * 2)
    if (this.lastIngest !== null) this.gapMs += (now - this.lastIngest - this.gapMs) * GAP_SMOOTHING
    this.lastIngest = now

    for (const f of flights) {
      const existing = this.tracks.get(f.hex)
      if (f.isVehicle) continue
      if (!f.onGround || f.distanceNm > DIORAMA.radiusNm) {
        // Took off or left the airport: the main map takes over.
        if (existing) this.tracks.delete(f.hex)
        continue
      }

      // Fast means a takeoff or landing roll: runways are straight, so predict ahead
      // like the airborne tracker does, and the two line up at liftoff and touchdown.
      // Easing from predicting a whole fetch ahead (runway speed) down to none
      // (taxi speed) keeps a slowing plane from lurching back as it turns off.
      // The delayed view never predicts ahead, so liftoff hands over a position behind the first airborne report.
      const lead = MOTION.delayed ? 0 : clamp(((f.groundSpeed ?? 0) - TAXI_SPEED_KT) / (RUNWAY_SPEED_KT - TAXI_SPEED_KT), 0, 1)
      const predicted = lead > 0 && f.track !== null
      const reported = predicted ? ahead(f, f.positionAge * 1000 + lead * (segmentMs || FEED.pollMs)) : { lat: f.lat, lon: f.lon }
      const stopped = (f.groundSpeed ?? 0) < DIORAMA.parkedSpeedKt
      if (!existing) {
        const landing = handoff(f.hex)
        const heading = f.track ?? landing?.heading ?? 0
        this.tracks.set(f.hex, {
          info: f,
          from: landing?.pos ?? reported,
          to: reported,
          fromHeading: landing?.heading ?? heading,
          toHeading: heading,
          segmentStart: now,
          // A landing glides down to its first ground report; anything else just appears there.
          segmentMs: landing ? segmentMs || FEED.pollMs : 0,
          fromHeightFt: landing?.heightFt ?? 0,
          predicted,
          // Already on screen in the air, so no fade-in.
          firstSeen: landing ? now - MOTION.fadeInMs : now,
          lastSeen: now,
          // Already sitting still when first seen: most likely parked.
          stoppedSince: stopped && !landing ? now - DIORAMA.parkedAfterMs : null,
          parked: stopped && !landing,
          pos: landing?.pos ?? reported,
          heading: landing?.heading ?? heading,
          heightFt: landing?.heightFt ?? 0,
          opacity: 0,
        })
        continue
      }

      existing.info = f
      existing.from = existing.pos
      // Don't glide backwards after a predicted-ahead target overshot: hold still until
      // the reports catch up. (Only then: pushbacks really do move backwards.)
      existing.to = existing.predicted && isBehind(existing.pos, reported, existing.heading) ? existing.pos : reported
      existing.predicted = predicted
      existing.fromHeading = existing.heading
      // Stopped aircraft often report no track (or a meaningless one); keep the last heading.
      existing.toHeading = stopped || f.track === null ? existing.heading : f.track
      existing.segmentStart = now
      existing.segmentMs = segmentMs
      existing.fromHeightFt = existing.heightFt
      existing.lastSeen = now
      existing.stoppedSince = stopped ? (existing.stoppedSince ?? now) : null
      existing.parked = existing.stoppedSince !== null && now - existing.stoppedSince >= DIORAMA.parkedAfterMs
    }
  }

  /** Advance every track to `now`. Call once per animation frame. */
  step(now: number) {
    for (const [hex, t] of this.tracks) {
      const keepFor = t.parked ? DIORAMA.keepParkedMs : DIORAMA.staleMs
      const overdue = overdueFor(now, t.lastSeen, this.lastIngest, this.gapMs, keepFor)
      if (overdue > MOTION.fadeOutMs) {
        this.tracks.delete(hex)
        continue
      }

      const u = t.segmentMs > 0 ? Math.min((now - t.segmentStart) / t.segmentMs, 1) : 1
      t.pos = { lat: t.from.lat + (t.to.lat - t.from.lat) * u, lon: t.from.lon + (t.to.lon - t.from.lon) * u }
      t.heading = t.fromHeading + (((t.toHeading - t.fromHeading + 540) % 360) - 180) * u
      t.heightFt = t.fromHeightFt * (1 - u)

      const fadeIn = Math.min((now - t.firstSeen) / MOTION.fadeInMs, 1)
      const fadeOut = 1 - Math.min(Math.max(overdue / MOTION.fadeOutMs, 0), 1)
      t.opacity = Math.min(fadeIn, fadeOut)
    }
  }

  /** Where a departing aircraft was drawn on the ground, for the airborne tracker to lift off from. */
  handoff(hex: string): Handoff | null {
    const t = this.tracks.get(hex)
    return t ? { pos: t.pos, heading: t.heading, heightFt: t.heightFt } : null
  }
}

/** How much each new gap between updates moves the running average (0 to 1). */
const GAP_SMOOTHING = 0.3
/** Ground speed (knots) of a takeoff or landing roll, predicted a whole fetch ahead... */
const RUNWAY_SPEED_KT = 40
/** ...down to taxiing, which runs a fetch behind instead. */
const TAXI_SPEED_KT = 15
const M_PER_DEG_LAT = 111_320
const MS_PER_KT = 0.514444 / 1000

/** Where `f` will be `ms` after its report, carrying on straight at its ground speed. */
function ahead(f: Flight, ms: number): LatLon {
  const meters = (f.groundSpeed ?? 0) * MS_PER_KT * ms
  const rad = ((f.track ?? 0) * Math.PI) / 180
  return {
    lat: f.lat + (meters * Math.cos(rad)) / M_PER_DEG_LAT,
    lon: f.lon + (meters * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((f.lat * Math.PI) / 180)),
  }
}

/** Whether `target` lies behind a plane at `pos` pointing along `heading`. */
function isBehind(pos: LatLon, target: LatLon, heading: number) {
  const north = target.lat - pos.lat
  const east = (target.lon - pos.lon) * Math.cos((pos.lat * Math.PI) / 180)
  const rad = (heading * Math.PI) / 180
  return north * Math.cos(rad) + east * Math.sin(rad) < 0
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}
