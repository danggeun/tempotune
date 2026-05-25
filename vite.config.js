import { defineConfig } from 'vite'

export default defineConfig({
  root: 'www',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
  },
  test: {
    include: ['src/**/*.test.js'],
  },
})
