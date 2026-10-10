import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'
import { API_ROUTES } from './api-routes.mjs'

// Neither API allows browser requests (no CORS headers), so proxy them.
const apiProxy: Record<string, ProxyOptions> = Object.fromEntries(
  Object.entries(API_ROUTES).map(([path, route]) => [
    path,
    { target: route.target, changeOrigin: true, rewrite: (p: string) => route.rewrite(p) ?? '/invalid' },
  ]),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
