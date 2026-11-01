import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
    // The JSON files we edit live in data/ (or DATA_DIR). Keep Vite's watcher
    // away from them so saving a file never triggers a dev-server reload.
    watch: { ignored: ['**/data/**', ...(process.env.DATA_DIR ? [`${process.env.DATA_DIR}/**`] : [])] },
  },
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
