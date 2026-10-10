import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { AircraftModels } from './aircraftModels'
import { AIRPORT, AIRPORT_PRESET, DIORAMA, MAP } from './config'
import {
  createDioramaView,
  drawDioramaAircraft,
  drawDioramaCaption,
  boxSilhouette,
  drawDioramaFront,
  fetchAirportLayout,
  renderDioramaBackground,
  type AirportLayout,
  type DioramaView,
  type ViewAngle,
} from './diorama'
import type { GroundTracker } from './groundTracker'
import { RESET_DIORAMA_EVENT, settingsVersion } from './settings'
import type { Tracker } from './tracker'

/** Where the panel sits and how big it is, in pixels. */
interface Placement {
  left: number
  top: number
  size: number
}

/**
 * The same as fractions of the window (left and size of its width, top of its
 * height), so it lands in the same spot on any screen size. Null until first
 * moved, while CSS places it.
 */
type SavedPlacement = Placement

interface Saved {
  placement: SavedPlacement | null
  angle: ViewAngle
}

const STORAGE_KEY = 'airportDiorama'
const DEFAULT_ANGLE: ViewAngle = {
  rotation: DIORAMA.rotationDeg,
  elevation: DIORAMA.elevationDeg,
}
const MIN_SIZE = 160
const MIN_ELEVATION = 10
const MAX_ELEVATION = 90
/** Degrees of rotation (and tilt) per pixel dragged. */
const DRAG_DEG_PER_PX = 0.4

/**
 * A small tilted 3D view of the airport in the top-right corner: runways,
 * taxiways and terminals, with aircraft taxiing, parked at gates, and flying
 * low overhead. Like the main map, it draws outside React every frame.
 *
 * Drag inside to rotate and tilt (double-click resets the angle), drag the
 * caption strip to move it, and drag the corner handle to resize it. The
 * layout is remembered in this browser.
 */
export function AirportDiorama({ tracker, ground }: { tracker: Tracker; ground: GroundTracker }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modelsRef = useRef<HTMLCanvasElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const [saved] = useState(loadSaved)
  const [placement, setPlacement] = useState<SavedPlacement | null>(saved.placement)
  const [rotating, setRotating] = useState(false)
  // Read by the animation loop, which rebuilds the scene when it changes.
  const angleRef = useRef<ViewAngle>(saved.angle)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const models = new AircraftModels(modelsRef.current!)
    let width = 0
    let height = 0
    let dpr = 1
    let layout: AirportLayout | null = null
    let view: DioramaView | null = null
    let background: HTMLCanvasElement | null = null
    let builtAngle: ViewAngle | null = null
    let builtSettings = settingsVersion()
    let backdropMask = ''

    const rebuild = () => {
      if (!layout || !width || !height) return
      builtAngle = angleRef.current
      builtSettings = settingsVersion()
      view = createDioramaView(layout, width, height, builtAngle)
      background = renderDioramaBackground(layout, view, width, height, dpr)
      backdropMask = silhouetteMask(boxSilhouette(view), width, height)
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      models.resize(width, height, dpr)
      rebuild()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const controller = new AbortController()
    fetchAirportLayout(AIRPORT, controller.signal)
      .then((l) => {
        layout = l
        rebuild()
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn('Airport layout unavailable:', err)
      })

    // Labels use the bundled web font; redraw once it arrives.
    document.fonts.load(`10px ${MAP.fontFamily}`).then(rebuild, () => {})

    let frame = requestAnimationFrame(function loop(now) {
      if (angleRef.current !== builtAngle || settingsVersion() !== builtSettings) rebuild()
      // The backdrop can appear after the scene was built (when its setting is turned on).
      const backdrop = backdropRef.current
      if (backdrop && backdrop.dataset.mask !== backdropMask) {
        backdrop.dataset.mask = backdropMask
        backdrop.style.maskImage = backdropMask
      }
      ground.step(now)
      ctx.clearRect(0, 0, width, height)
      if (view && background) {
        ctx.drawImage(background, 0, 0, width, height)
        // Shadows and drop lines stay in 2D; the aircraft go to the WebGL layer above when it's on.
        const use3d = DIORAMA.models3d && models.available
        const poses = drawDioramaAircraft(ctx, view, ground.tracks.values(), tracker.tracks.values(), !use3d)
        drawDioramaFront(ctx, view)
        drawDioramaCaption(ctx, view, caption(ground))
        models.render(view, use3d ? poses : [])
      }
      frame = requestAnimationFrame(loop)
    })

    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      models.dispose()
    }
  }, [tracker, ground])

  const save = (next: Partial<Saved>) => storeSaved({ placement, angle: angleRef.current, ...next })

  /** Runs `onMove` with the pointer's offset from where the drag started, until it's released. */
  const drag = (e: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const [startX, startY] = [e.clientX, e.clientY]
    const move = (ev: PointerEvent) => onMove(ev.clientX - startX, ev.clientY - startY)
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      onEnd()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  /** The panel's current placement in pixels, measured from the page. */
  const currentPlacement = (): Placement => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { left: rect.left, top: rect.top, size: rect.width }
  }

  const startRotate = (e: ReactPointerEvent) => {
    const start = angleRef.current
    setRotating(true)
    drag(
      e,
      (dx, dy) => {
        angleRef.current = {
          rotation: (start.rotation + dx * DRAG_DEG_PER_PX + 360) % 360,
          elevation: clamp(start.elevation + dy * DRAG_DEG_PER_PX, MIN_ELEVATION, MAX_ELEVATION),
        }
      },
      () => {
        setRotating(false)
        save({})
      },
    )
  }

  const startMove = (e: ReactPointerEvent) => {
    const start = currentPlacement()
    let latest = toFractions(start)
    drag(
      e,
      (dx, dy) => {
        latest = toFractions({
          ...start,
          left: clamp(start.left + dx, 0, window.innerWidth - start.size),
          top: clamp(start.top + dy, 0, window.innerHeight - start.size),
        })
        setPlacement(latest)
      },
      () => save({ placement: latest }),
    )
  }

  const startResize = (e: ReactPointerEvent) => {
    const start = currentPlacement()
    let latest = toFractions(start)
    drag(
      e,
      (dx, dy) => {
        const maxSize = Math.min(window.innerWidth - start.left, window.innerHeight - start.top)
        latest = toFractions({
          ...start,
          size: clamp(start.size + Math.max(dx, dy), MIN_SIZE, maxSize),
        })
        setPlacement(latest)
      },
      () => save({ placement: latest }),
    )
  }

  // The settings panel can put it back in its corner at the starting angle.
  useEffect(() => {
    const reset = () => {
      angleRef.current = DEFAULT_ANGLE
      setPlacement(null)
      storeSaved({ placement: null, angle: DEFAULT_ANGLE })
    }
    window.addEventListener(RESET_DIORAMA_EVENT, reset)
    return () => window.removeEventListener(RESET_DIORAMA_EVENT, reset)
  }, [])

  const resetAngle = () => {
    angleRef.current = DEFAULT_ANGLE
    save({})
  }

  // Viewport units keep it in proportion when the window changes size. Clamped
  // so a spot saved on a wider screen still fits on a narrower one.
  const style: CSSProperties | undefined = placement
    ? {
        left: `min(${placement.left * 100}vw, ${100 - placement.size * 100}vw)`,
        top: `min(${placement.top * 100}vh, 100vh - ${placement.size * 100}vw)`,
        width: `${placement.size * 100}vw`,
        right: 'auto',
      }
    : undefined

  return (
    <>
      <Backdrop style={style} ref={backdropRef} />
      <div ref={containerRef} className={`diorama${rotating ? ' is-rotating' : ''}${DIORAMA.locked ? ' is-locked' : ''}`} style={style}>
        <canvas ref={canvasRef} onPointerDown={startRotate} onDoubleClick={resetAngle} />
        <canvas ref={modelsRef} className="diorama-models" />
        <div className="diorama-move" onPointerDown={startMove} title="Drag to move" />
        <div className="diorama-resize" onPointerDown={startResize} title="Drag to resize" />
      </div>
    </>
  )
}

/** "KDFW SURFACE  3 TAXIING · 41 PARKED" */
function caption(ground: GroundTracker) {
  let taxiing = 0
  let parked = 0
  for (const t of ground.tracks.values()) {
    if (t.opacity <= 0) continue
    if (t.parked) parked++
    else taxiing++
  }
  return `${AIRPORT_PRESET.icao} SURFACE  ${taxiing} TAXIING · ${parked} PARKED`
}

/**
 * Blurs and/or darkens the map behind the airport so it reads clearly. Masked
 * to the box's outline on screen (set by the animation loop as the view
 * turns), with softened edges.
 *
 * It's a sibling placed exactly under the panel rather than inside it: the
 * panel sits above the board, but this stays below it, so it only ever blurs
 * the map and never the board, METAR or ATIS.
 */
function Backdrop({ style, ref }: { style: CSSProperties | undefined; ref: Ref<HTMLDivElement> }) {
  const blur = DIORAMA.backdropBlur
  const darkness = DIORAMA.backdropDarkness
  if (blur <= 0 && darkness <= 0) return null
  return (
    <div
      ref={ref}
      className="diorama-backdrop"
      style={{
        ...style,
        backdropFilter: blur > 0 ? `blur(${blur}px)` : undefined,
        background: darkness > 0 ? `rgb(3 5 10 / ${darkness})` : undefined,
      }}
    />
  )
}

/**
 * A CSS mask image of `outline` as an SVG polygon whose edge fades out over
 * about DIORAMA.backdropFeather pixels. The polygon is shrunk before it's
 * blurred, so the fade happens mostly inside the outline rather than spilling
 * past it (and being cut off at the panel's edge).
 */
function silhouetteMask(outline: { x: number; y: number }[], width: number, height: number) {
  const points = outline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const feather = Math.max(DIORAMA.backdropFeather, 0)
  const filter =
    feather > 0
      ? `<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
        `<feMorphology operator="erode" radius="${feather * 0.6}"/>` +
        `<feGaussianBlur stdDeviation="${feather * 0.45}"/></filter>`
      : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${filter}<polygon points="${points}" fill="#000"${feather > 0 ? ' filter="url(#f)"' : ''}/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function loadSaved(): Saved {
  const fallback: Saved = { placement: null, angle: DEFAULT_ANGLE }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null
    if (!saved) return fallback
    // Placements saved as pixels by an earlier version have values above 1.
    const p = saved.placement
    const valid = p && [p.left, p.top, p.size].every((v) => v >= 0 && v <= 1)
    return { placement: valid ? p : null, angle: saved.angle ?? DEFAULT_ANGLE }
  } catch {
    return fallback
  }
}

function toFractions(p: Placement): SavedPlacement {
  return {
    left: p.left / window.innerWidth,
    top: p.top / window.innerHeight,
    size: p.size / window.innerWidth,
  }
}

/** Kept in localStorage, so it lasts across sessions in this browser. */
function storeSaved(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage can be unavailable (private windows); the panel just won't remember.
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}
