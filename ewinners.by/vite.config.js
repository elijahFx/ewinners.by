import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://test.zkh.by',
        changeOrigin: true,
        secure: true,
      },
      '/socket.io': {
        target: 'https://test.zkh.by',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
      '/uploads': {
        target: 'https://test.zkh.by',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
