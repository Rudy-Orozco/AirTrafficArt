import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

/** adsb.lol's largest allowed query radius. */
const MAX_RADIUS_NM = 250

// Neither API allows browser requests (no CORS headers), so proxy them.
const apiProxy: Record<string, ProxyOptions> = {
  // /api/aircraft?lat=..&lon=..&radius=.. -> adsb.lol's point query.
  '/api/aircraft': {
    target: 'https://api.adsb.lol',
    changeOrigin: true,
    rewrite: (path) => {
      const params = new URL(path, 'http://localhost').searchParams
      const [lat, lon, radius] = ['lat', 'lon', 'radius'].map((k) => Number(params.get(k)))
      if (![lat, lon, radius].every(Number.isFinite)) return '/invalid'
      return `/v2/point/${lat}/${lon}/${Math.min(Math.ceil(radius), MAX_RADIUS_NM)}`
    },
  },
  // /api/metar?ids=KDFW -> current weather report from aviationweather.gov.
  '/api/metar': {
    target: 'https://aviationweather.gov',
    changeOrigin: true,
    rewrite: (path) => {
      const ids = new URL(path, 'http://localhost').searchParams.get('ids') ?? ''
      if (!/^[A-Z0-9]{4}$/.test(ids)) return '/invalid'
      return `/api/data/metar?ids=${ids}&format=json&hours=2`
    },
  },
  // Callsign -> origin/destination lookups.
  '/api/routeset': {
    target: 'https://adsb.im',
    changeOrigin: true,
    rewrite: () => '/api/0/routeset',
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
