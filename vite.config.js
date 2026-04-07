import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // TEMPORARY (debug): keep function names so React error stack traces
  // show real component names instead of mangled `z0` etc.
  esbuild: {
    keepNames: true,
  },
  build: {
    minify: false,
  },
})
