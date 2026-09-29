import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
      },
      '/socket.io': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
      '/uploads': {
        target: 'https://178.172.137.114.sslip.io',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
