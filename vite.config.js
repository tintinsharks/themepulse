import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // TEMPORARY (Phase 2.7 debug): disable minification so React error
  // messages show the actual cause, not error #310 codes. Remove once
  // the render crash is fixed.
  build: {
    minify: false,
  },
})
