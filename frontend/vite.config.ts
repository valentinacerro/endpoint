import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      // Manifest strings are user interface, so they follow the UI language
      // (Italian), not the language of the codebase.
      manifest: {
        name: 'endpoint',
        short_name: 'endpoint',
        description: 'Itinerari, prenotazioni e documenti, consultabili anche offline.',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Puts the app in Android's share sheet. Open a place in Google
        // Maps, tap Share, choose endpoint, and the link arrives here —
        // no copying, no pasting, no Takeout export.
        //
        // GET rather than POST: the share is a plain navigation, so it
        // survives the login screen appearing in front of it. The link
        // stays in the address bar and the route picks it up again once
        // the session is there.
        //
        // All three fields are declared because Android decides for
        // itself which to use, and Maps puts the link inside `text`
        // alongside the place name rather than in `url`.
        share_target: {
          action: '/share',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        background_color: '#f8f7f3',
        theme_color: '#f8f7f3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // `.mjs` matters: pdf.js ships its worker as one, and without it in
        // the precache the PDF viewer works online and silently fails in
        // airplane mode — which is the only time it really has to work.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // The service worker owns the app shell; the app owns the data.
        // Without this exclusion a failed API call would return the home
        // page's HTML instead of an error.
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // The compiled PWA is served by FastAPI: same origin, first-party
    // cookies, no CORS.
    outDir: '../backend/app/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // In development the proxy reproduces the single origin of production.
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
})
