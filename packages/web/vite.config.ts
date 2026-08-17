import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8790',
      '/health': 'http://127.0.0.1:8790',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: new URL('./index.html', import.meta.url).pathname,
        local: new URL('./local.html', import.meta.url).pathname,
      },
    },
  },
})
