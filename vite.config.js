import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Dev only: the /api functions run on Vercel, so proxy them to production
  // for `npm run dev` (live quotes, OHLC, charts). Ignored by `vite build`.
  server: {
    proxy: {
      "/api": { target: "https://themepulse.vercel.app", changeOrigin: true },
    },
  },
  // Keep function names in production builds so React error stack traces
  // show real component names instead of mangled identifiers.
  esbuild: {
    keepNames: true,
  },
})
