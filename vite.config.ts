import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths so the build works on GitHub Pages under /<repo>/
  base: './',
  plugins: [react()],
  // The motion studio and its WASM AAC encoder are large, but both load only on demand.
  build: { chunkSizeWarningLimit: 1100 },
})
