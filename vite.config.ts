import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig(({ mode }) =>
  mode === 'artifact'
    ? {
        // `npm run build:artifact`: the live Motion studio as one self-contained HTML file,
        // published as a claude.ai Artifact so Claude's edits show up while it works.
        base: './',
        plugins: [
          react(),
          viteSingleFile(),
          {
            name: 'artifact-html',
            transformIndexHtml: (html) =>
              html.replace('<title>Video Editor</title>', '<title>Motion Live</title>').replace(/\s*<link rel="icon"[^>]*>/, ''),
          },
        ],
        build: { outDir: 'dist-artifact', chunkSizeWarningLimit: 4000 },
      }
    : {
        // Relative paths so the build works on GitHub Pages under /<repo>/
        base: './',
        plugins: [react()],
        // The motion studio and its WASM AAC encoder are large, but both load only on demand.
        build: { chunkSizeWarningLimit: 1100 },
      },
)
