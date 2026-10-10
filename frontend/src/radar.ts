import { CENTER, FEED, FETCH_RADIUS_NM, MAP } from './config'

/** A radar image covering `bounds`, ready to draw, plus when it was scanned. */
export interface Radar {
  image: HTMLCanvasElement
  bounds: { west: number; south: number; east: number; north: number }
  validTime: Date | null
}

/** Same area as the aircraft query, so radar covers the whole screen. */
const BOUNDS = (() => {
  const dLat = FETCH_RADIUS_NM / 60
  const dLon = FETCH_RADIUS_NM / (60 * Math.cos((CENTER.lat * Math.PI) / 180))
  return { west: CENTER.lon - dLon, south: CENTER.lat - dLat, east: CENTER.lon + dLon, north: CENTER.lat + dLat }
})()
/** Roughly the radar's 1 km resolution across the area. */
const IMAGE_SIZE = 1024

/**
 * NOAA's MRMS (Multi-Radar Multi-Sensor) quality-controlled base reflectivity
 * for the continental US: every NEXRAD radar merged, with ground clutter,
 * birds and insects filtered out, updated about every 2 minutes. Requested in
 * plain lat/lon (EPSG:4326), which our map projection maps linearly, so the
 * image just stretches onto the map. The server allows browser requests.
 */
const LAYER = 'conus_bref_qcd'
const WMS_URL = `https://opengeo.ncep.noaa.gov/geoserver/conus/${LAYER}/ows`

export async function loadRadar(signal: AbortSignal): Promise<Radar> {
  const { west, south, east, north } = BOUNDS
  // Ask for the latest scan by its time, so the image and the time shown match.
  const validTime = await loadLatestTime(signal)
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: LAYER,
    STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: [west, south, east, north].map((v) => v.toFixed(4)).join(','),
    WIDTH: `${IMAGE_SIZE}`,
    HEIGHT: `${IMAGE_SIZE}`,
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  })
  if (validTime) params.set('TIME', validTime.toISOString())

  const image = await loadImage(`${WMS_URL}?${params}`, signal)
  return { image: MAP.radar.hideLightEchoes ? withoutLightEchoes(image) : toCanvas(image), bounds: BOUNDS, validTime }
}

async function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(FEED.requestTimeoutMs * 2)]) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blobUrl = URL.createObjectURL(await res.blob())
  try {
    const image = new Image()
    image.src = blobUrl
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/** The newest scan's time, the default of the layer's time dimension in its capabilities. */
async function loadLatestTime(signal: AbortSignal): Promise<Date | null> {
  try {
    const params = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetCapabilities' })
    const res = await fetch(`${WMS_URL}?${params}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(FEED.requestTimeoutMs)]),
    })
    const match = (await res.text()).match(/<Dimension[^>]*name="time"[^>]*default="([^"]+)"/)
    const time = match ? new Date(match[1]) : null
    return time && !Number.isNaN(time.getTime()) ? time : null
  } catch (err) {
    if (signal.aborted) throw err
    // Without a time, ask for the default (latest) scan and show no timestamp.
    return null
  }
}

function toCanvas(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  return canvas
}

/**
 * Drops the weakest returns, below about 20 dBZ: the blues, cyans and teals of
 * the color scale. MRMS already removes most clutter, birds and insects; what's
 * left down there is mostly drizzle and virga that never reaches the ground. Keeps rain and storms: pure green (~20 dBZ, light rain) through
 * yellow, red and purple.
 */
function withoutLightEchoes(image: HTMLImageElement) {
  const canvas = toCanvas(image)
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = pixels.data
  for (let i = 0; i < d.length; i += 4) {
    // Weak returns all carry a strong blue component; only red/purple storms also do.
    if (d[i + 2] > 80 && d[i] < 150) d[i + 3] = 0
  }
  despeckle(d, canvas.width, canvas.height)
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

/** Neighborhood checked around each pixel (an 11×11 square, about 5 km)... */
const SPECKLE_RADIUS = 5
/** ...of which at least this share must also be precipitation to keep it. */
const SPECKLE_MIN_FILL = 0.35

/**
 * Removes isolated returns. Rain and storms form solid areas, while leftover
 * clutter is scattered single radar cells, so a pixel survives only if enough
 * of its neighborhood is filled too. Uses a summed-area table, so it's one
 * pass however big the neighborhood is.
 */
function despeckle(d: Uint8ClampedArray, width: number, height: number) {
  const sums = new Uint32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += d[(y * width + x) * 4 + 3] > 0 ? 1 : 0
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row
    }
  }

  const r = SPECKLE_RADIUS
  const minCount = (2 * r + 1) ** 2 * SPECKLE_MIN_FILL
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = (y * width + x) * 4 + 3
      if (d[alpha] === 0) continue
      const x0 = Math.max(0, x - r)
      const y0 = Math.max(0, y - r)
      const x1 = Math.min(width, x + r + 1)
      const y1 = Math.min(height, y + r + 1)
      const w = width + 1
      const count = sums[y1 * w + x1] - sums[y0 * w + x1] - sums[y1 * w + x0] + sums[y0 * w + x0]
      if (count < minCount) d[alpha] = 0
    }
  }
}
