import { useEffect, useRef } from 'react'
import { fetchBasemap, type Basemap } from './basemap'
import { CENTER, VIEW_RADIUS_NM } from './config'
import { createProjection, drawTracks, renderBackground } from './renderer'
import type { Tracker } from './tracker'

/**
 * Full-screen canvas driven by requestAnimationFrame. All per-frame work happens
 * outside React so the 60 fps loop never triggers a re-render.
 */
export function AirTrafficCanvas({ tracker }: { tracker: Tracker }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: false })!

    let width = 0
    let height = 0
    let dpr = 1
    let basemap: Basemap | null = null
    let project = createProjection(1, 1, CENTER, VIEW_RADIUS_NM)
    let background = renderBackground(1, 1, 1, VIEW_RADIUS_NM, project, null)

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      project = createProjection(width, height, CENTER, VIEW_RADIUS_NM)
      background = renderBackground(width, height, dpr, VIEW_RADIUS_NM, project, basemap)
    }
    resize()
    window.addEventListener('resize', resize)

    // The map is optional: draw without it until it loads, or if it's missing.
    const controller = new AbortController()
    fetchBasemap(controller.signal)
      .then((map) => {
        basemap = map
        background = renderBackground(width, height, dpr, VIEW_RADIUS_NM, project, basemap)
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn('Basemap unavailable:', err)
      })

    let frame = requestAnimationFrame(function loop(now) {
      tracker.step(now)
      ctx.drawImage(background, 0, 0, width, height)
      drawTracks(ctx, tracker.tracks.values(), project)
      frame = requestAnimationFrame(loop)
    })

    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [tracker])

  return <canvas ref={canvasRef} className="radar" />
}
