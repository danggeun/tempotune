import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// base: GitHub Pages 는 /go_practice/, Capacitor 빌드(build:cap)는 / (package.json scripts 참고)
export default defineConfig(({ mode }) => ({
  root: 'www',
  base: process.env.BASE ?? '/go_practice/',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, open: false },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Capacitor 앱에서는 파일이 로컬이라 SW 가 불필요하지만 무해. 웹(PWA)에서는 전 자산을 프리캐시해 오프라인 동작.
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,png,webmanifest}'], navigateFallback: null, cleanupOutdatedCaches: true },
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Go practice', short_name: 'Go practice', description: '현악기 연습 — 튜너 · 메트로놈 · 녹음 편집',
        display: 'standalone', orientation: 'portrait', background_color: '#f7f8fb', theme_color: '#f7f8fb', lang: 'ko',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
}))
