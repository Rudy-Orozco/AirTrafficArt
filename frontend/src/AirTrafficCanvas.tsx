import { useEffect, useRef, type RefObject } from 'react'
import { CENTER, VIEW_RADIUS_NM } from './config'
import { watchMapLayers, type MapLayers } from './mapLayers'
import { createProjection, createView, drawTracks, labelFont, renderBackground } from './renderer'
import { settingsVersion } from './settings'
import type { Tracker } from './tracker'
import { uncoveredArea } from './layout'

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
    let layers: MapLayers = { basemap: null, radar: null, terrain: null }
    let view = createView(1, 1, VIEW_RADIUS_NM)
    let project = createProjection(view, CENTER)
    let background = renderBackground(1, 1, 1, view, project, null)

    const redrawBackground = () => {
      background = renderBackground(width, height, dpr, view, project, layers.basemap, layers.radar, layers.terrain)
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

    // Radar is baked into the background too, so it costs nothing per frame;
    // the background is redrawn whenever a new scan arrives.
    const stopLayers = watchMapLayers((loaded) => {
      layers = loaded
      redrawBackground()
    })

    // Labels baked into the background need redrawing once the web font arrives.
    document.fonts.load(labelFont()).then(redrawBackground, () => {})

    // Ring spacing, radar opacity and label size are baked into the background.
    let builtSettings = settingsVersion()
    let frame = requestAnimationFrame(function loop(now) {
      if (settingsVersion() !== builtSettings) {
        builtSettings = settingsVersion()
        redrawBackground()
      }
      tracker.step(now)
      ctx.drawImage(background, 0, 0, width, height)
      drawTracks(ctx, tracker.tracks.values(), project)
      frame = requestAnimationFrame(loop)
    })

    return () => {
      stopLayers()
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [tracker, overlay])

  return <canvas ref={canvasRef} className="radar" />
}
