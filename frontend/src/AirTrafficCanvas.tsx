import { useEffect, useRef, type RefObject } from 'react'
import { fetchBasemap, type Basemap } from './basemap'
import { AIRPORT, CENTER, VIEW_RADIUS_NM } from './config'
import { createProjection, createView, drawTracks, LABEL_FONT, renderBackground } from './renderer'
import type { Tracker } from './tracker'

/**
 * Full-screen map canvas driven by requestAnimationFrame. All per-frame work
 * happens outside React so the 60 fps loop never triggers a re-render.
 *
 * `overlay` is the board drawn on top of the map; the map centers itself in the
 * area the board leaves uncovered.
 */
export function AirTrafficCanvas({ tracker, overlay }: { tracker: Tracker; overlay: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: false })!

    let width = 0
    let height = 0
    let dpr = 1
    let basemap: Basemap | null = null
    let view = createView(1, 1, VIEW_RADIUS_NM)
    let project = createProjection(view, CENTER)
    let background = renderBackground(1, 1, 1, view, project, null)

    const redrawBackground = () => {
      background = renderBackground(width, height, dpr, view, project, basemap)
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const visible = uncoveredArea(width, height, overlay.current)
      view = createView(visible.width, visible.height, VIEW_RADIUS_NM)
      project = createProjection(view, CENTER)
      redrawBackground()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    if (overlay.current) observer.observe(overlay.current)
    resize()

    // The map is optional: draw without it until it loads, or if it's missing.
    const controller = new AbortController()
    fetchBasemap(AIRPORT, controller.signal)
      .then((map) => {
        basemap = map
        redrawBackground()
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn('Basemap unavailable:', err)
      })
    // Labels baked into the background need redrawing once the web font arrives.
    document.fonts.load(LABEL_FONT).then(redrawBackground, () => {})

    let frame = requestAnimationFrame(function loop(now) {
      tracker.step(now)
      ctx.drawImage(background, 0, 0, width, height)
      drawTracks(ctx, tracker.tracks.values(), project)
      frame = requestAnimationFrame(loop)
    })

    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [tracker, overlay])

  return <canvas ref={canvasRef} className="radar" />
}

/**
 * The part of the screen not covered by the overlay, which sits along the bottom
 * (portrait) or the right (landscape). Its fade-in padding counts half as visible.
 */
function uncoveredArea(width: number, height: number, overlay: HTMLElement | null) {
  if (!overlay) return { width, height }
  const rect = overlay.getBoundingClientRect()
  const style = getComputedStyle(overlay)
  if (rect.left > 0) return { width: rect.left + parseFloat(style.paddingLeft) / 2, height }
  return { width, height: rect.top + parseFloat(style.paddingTop) / 2 }
}
