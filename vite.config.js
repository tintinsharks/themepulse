import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Keep function names in production builds so React error stack traces
  // show real component names instead of mangled identifiers.
  esbuild: {
    keepNames: true,
  },
})
