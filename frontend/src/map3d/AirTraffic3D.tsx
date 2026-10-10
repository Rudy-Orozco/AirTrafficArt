import { useEffect, useRef, type RefObject } from 'react'
import { uncoveredArea } from '../lib/layout'
import { Map3D } from './map3d'
import { watchMapLayers, type MapLayers } from '../map/mapLayers'
import { labelFont } from '../map/renderer'
import { RESET_CAMERA_EVENT, settingsVersion } from '../config/settings'
import type { Tracker } from '../tracking/tracker'
import './AirTraffic3D.css'

/**
 * The 3D map: a full-screen WebGL scene (see map3d.ts) with a 2D canvas over it
 * for labels. Drag to orbit, right-drag to pan, scroll or pinch to zoom; the
 * camera is remembered. Like the flat map, it draws outside React every frame
 * and centers itself in the area the board (`overlay`) leaves uncovered.
 */
export function AirTraffic3D({ tracker, overlay }: { tracker: Tracker; overlay: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelsRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    let map: Map3D
    try {
      map = new Map3D(canvas, labelsRef.current!)
    } catch (err) {
      console.warn('3D map unavailable (no WebGL?):', err)
      return
    }
    let layers: MapLayers = { basemap: null, radar: null, terrain: null }
    const redrawGround = () => map.setBackground(layers)
    redrawGround()

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      map.resize(width, height, window.devicePixelRatio || 1, uncoveredArea(width, height, overlay.current))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    if (overlay.current) observer.observe(overlay.current)
    resize()

    const stopLayers = watchMapLayers((loaded) => {
      layers = loaded
      redrawGround()
    })
    document.fonts.load(labelFont()).then(redrawGround, () => {})

    const reset = () => map.resetCamera()
    window.addEventListener(RESET_CAMERA_EVENT, reset)

    // Ring spacing, radar opacity and label size are baked into the ground.
    let builtSettings = settingsVersion()
    let frame = requestAnimationFrame(function loop(now) {
      if (settingsVersion() !== builtSettings) {
        builtSettings = settingsVersion()
        redrawGround()
      }
      tracker.step(now)
      map.render(tracker.tracks.values())
      frame = requestAnimationFrame(loop)
    })

    return () => {
      stopLayers()
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener(RESET_CAMERA_EVENT, reset)
      map.dispose()
    }
  }, [tracker, overlay])

  return (
    <>
      <canvas ref={canvasRef} className="radar map3d" />
      <canvas ref={labelsRef} className="radar map3d-labels" />
    </>
  )
}
