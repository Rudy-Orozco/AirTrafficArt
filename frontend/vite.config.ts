import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  // A 9:16 portrait screen's half-diagonal is ~2.04x half its short side,
  // so fetch a wider radius than we display to fill the corners.
  const fetchRadiusNm = Math.min(250, Math.ceil(Number(env.VITE_VIEW_RADIUS_NM) * 2.1))

  // Stand-in for the FastAPI backend: proxy /api/aircraft straight to adsb.lol.
  const aircraftProxy: Record<string, ProxyOptions> = {
    '/api/aircraft': {
      target: 'https://api.adsb.lol',
      changeOrigin: true,
      rewrite: () => `/v2/point/${env.VITE_CENTER_LAT}/${env.VITE_CENTER_LON}/${fetchRadiusNm}`,
    },
  }

  return {
    plugins: [react()],
    server: { proxy: aircraftProxy },
    preview: { proxy: aircraftProxy },
  }
})
