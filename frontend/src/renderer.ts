import type { Basemap, Line } from './basemap'
import type { LatLon, Track } from './tracker'

export interface Point {
  x: number
  y: number
}

export type Projection = (p: LatLon) => Point

const NM_PER_DEG_LAT = 60
const RING_SPACING_NM = 10
const PLANE_SIZE = 9
const LABEL_FONT = '12px ui-monospace, "DejaVu Sans Mono", monospace'

/**
 * Flat projection centered on `center`. Accurate enough for a ~100 nm view and
 * much cheaper than Web Mercator. `radiusNm` maps to half the screen's short side.
 */
export function createProjection(width: number, height: number, center: LatLon, radiusNm: number): Projection {
  const pxPerNm = Math.min(width, height) / 2 / radiusNm
  const lonScale = Math.cos((center.lat * Math.PI) / 180)
  return ({ lat, lon }) => ({
    x: width / 2 + (lon - center.lon) * NM_PER_DEG_LAT * lonScale * pxPerNm,
    y: height / 2 - (lat - center.lat) * NM_PER_DEG_LAT * pxPerNm,
  })
}

/**
 * Draws everything that never moves (backdrop, map, range rings) to an offscreen
 * canvas once, so each frame just blits it instead of redrawing.
 */
export function renderBackground(
  width: number,
  height: number,
  dpr: number,
  radiusNm: number,
  project: Projection,
  basemap: Basemap | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const cx = width / 2
  const cy = height / 2
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy))
  gradient.addColorStop(0, '#0b1424')
  gradient.addColorStop(1, '#03050a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  if (basemap) drawBasemap(ctx, basemap, project, width, height)

  const pxPerNm = Math.min(width, height) / 2 / radiusNm
  const maxRingNm = Math.hypot(cx, cy) / pxPerNm
  ctx.strokeStyle = 'rgba(120, 160, 220, 0.12)'
  ctx.fillStyle = 'rgba(120, 160, 220, 0.35)'
  ctx.lineWidth = 1
  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'
  for (let nm = RING_SPACING_NM; nm <= maxRingNm; nm += RING_SPACING_NM) {
    const r = nm * pxPerNm
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillText(`${nm}`, cx, cy - r - 4)
  }

  return canvas
}

/** Faint water and freeways for orientation, with runways as the brightest detail. */
function drawBasemap(ctx: CanvasRenderingContext2D, map: Basemap, project: Projection, width: number, height: number) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  for (const ring of map.water) tracePath(ctx, ring, project, true)
  ctx.fillStyle = 'rgba(50, 100, 170, 0.22)'
  ctx.fill()

  strokeLines(ctx, map.rivers, project, 'rgba(50, 100, 170, 0.18)', 0.75)
  strokeLines(ctx, map.highways, project, 'rgba(140, 160, 200, 0.10)', 1)
  strokeLines(ctx, map.runways, project, 'rgba(190, 205, 230, 0.45)', 2.5)

  ctx.font = '11px ui-monospace, "DejaVu Sans Mono", monospace'
  ctx.letterSpacing = '3px'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(160, 180, 215, 0.28)'
  for (const city of map.cities) {
    const p = project(city)
    ctx.fillText(city.name.toUpperCase(), p.x, p.y)
  }

  ctx.font = LABEL_FONT
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(160, 180, 215, 0.25)'
  ctx.fillText(map.attribution, width - 12, height - 12)
}

/** Strokes every line as one path, which is far cheaper than stroking each separately. */
function strokeLines(ctx: CanvasRenderingContext2D, lines: Line[], project: Projection, color: string, width: number) {
  ctx.beginPath()
  for (const line of lines) tracePath(ctx, line, project, false)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function tracePath(ctx: CanvasRenderingContext2D, line: Line, project: Projection, close: boolean) {
  line.forEach(([lon, lat], i) => {
    const p = project({ lat, lon })
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  if (close) ctx.closePath()
}

export function drawTracks(ctx: CanvasRenderingContext2D, tracks: Iterable<Track>, project: Projection) {
  ctx.font = LABEL_FONT
  ctx.textAlign = 'left'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const t of tracks) {
    if (t.opacity <= 0) continue
    const hue = altitudeHue(t.info.altitude, t.info.onGround)
    const pos = project(t.pos)

    drawTrail(ctx, t, pos, project, hue)

    // Parked and taxiing aircraft are drawn small and dim so airports stay legible.
    ctx.globalAlpha = t.info.onGround ? t.opacity * 0.5 : t.opacity
    ctx.fillStyle = `hsl(${hue} 90% 65%)`
    drawPlane(ctx, pos, t.heading, t.info.onGround ? PLANE_SIZE * 0.5 : PLANE_SIZE)

    // Parked aircraft cluster at airports; labeling them is just clutter.
    if (!t.info.onGround) {
      ctx.fillStyle = `hsl(${hue} 40% 80% / 0.75)`
      ctx.fillText(label(t), pos.x + PLANE_SIZE + 3, pos.y + 4)
    }
    ctx.globalAlpha = 1
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, t: Track, pos: Point, project: Projection, hue: number) {
  if (t.trail.length < 2) return
  const start = project(t.trail[0])

  // One path per plane with a tail-to-head gradient: looks like a fading trail
  // at a fraction of the cost of stroking every segment separately.
  const gradient = ctx.createLinearGradient(start.x, start.y, pos.x, pos.y)
  gradient.addColorStop(0, `hsl(${hue} 90% 60% / 0)`)
  gradient.addColorStop(1, `hsl(${hue} 90% 60% / ${0.55 * t.opacity})`)

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 1; i < t.trail.length; i++) {
    const p = project(t.trail[i])
    ctx.lineTo(p.x, p.y)
  }
  ctx.lineTo(pos.x, pos.y)
  ctx.strokeStyle = gradient
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/** An arrowhead pointing along `heading` (degrees clockwise from north). */
function drawPlane(ctx: CanvasRenderingContext2D, pos: Point, heading: number, size: number) {
  ctx.save()
  ctx.translate(pos.x, pos.y)
  ctx.rotate((heading * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.65, size * 0.7)
  ctx.lineTo(0, size * 0.3)
  ctx.lineTo(-size * 0.65, size * 0.7)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function label(t: Track) {
  const { callsign, altitude } = t.info
  if (altitude === null) return callsign
  return `${callsign} ${Math.round(altitude / 100).toString().padStart(3, '0')}`
}

/** Warm colors near the ground, cooling to blue/violet at cruise altitude. */
function altitudeHue(altitude: number | null, onGround: boolean) {
  if (onGround || altitude === null) return 40
  return 20 + Math.min(altitude / 40_000, 1) * 240
}
