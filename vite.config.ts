import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json';

const isAndroid = process.env.VITE_PLATFORM === 'android';

export default defineConfig({
  base: isAndroid ? './' : '/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  // Build version for the Settings > App info card (settings.tsx).
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    !isAndroid &&
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Precache the app shell: html/js/css bundle + brand icons + the
        // tiny offline fallback page (all copied into dist/, incl. public/).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Drop superseded precaches on SW update.
        cleanupOutdatedCaches: true,

        /**
         * OFFLINE FALLBACK
         *
         * The app is hash-routed, so a navigation to `/` is matched by the
         * precache route first (workbox resolves `/` → precached
         * `index.html` via `directoryIndex`) and the app shell itself is
         * served offline. Any OTHER navigation URL falls through to the
         * NavigationRoute below → the tiny offline.html page.
         */
        navigateFallback: '/offline.html',
        // A navigation fallback must never answer for the API endpoints.
        navigateFallbackDenylist: [/^\/mapi/, /^\/rvsgeo/],

        runtimeCaching: [
          {
            /**
             * Map tiles. Both map screens use Leaflet with
             * https://tile.openstreetmap.org/{z}/{x}/{y}.png (legacy a/b/c
             * tile subdomains matched too). Tiles are immutable per z/x/y,
             * so CacheFirst + an expiry sweep is safe and keeps the maps
             * usable offline. Leaflet loads tiles as <img> → responses are
             * opaque (status 0) and must be listed as cacheable.
             */
            urlPattern: /^https:\/\/(?:[a-z0-9-]+\.)*tile\.openstreetmap\.org\/.*$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'maptiles-v1',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          /**
           * ⛔ /mapi IS DELIBERATELY ABSENT FROM runtimeCaching — the vendor
           * API must NEVER be cached. Every response carries live device
           * positions and session state that is stale the moment it is
           * written; serving any of it from a cache would be a correctness
           * and privacy bug. Never add a runtime rule whose urlPattern can
           * match same-origin /mapi (or /rvsgeo). Same reason, no
           * NetworkFirst/NetworkOnly rules: no rule at all means the
           * request always goes to the vendor.
           */
        ],
      },
      manifest: {
        name: 'QXGPS Lite (Ad Free)',
        short_name: 'QXGPS Lite',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          // apple-touch-icon.png (180², full-bleed) is auto-discovered by
          // iOS at the site root; no manifest entry needed.
        ],
      },
    }),
  ].filter(Boolean),
});
