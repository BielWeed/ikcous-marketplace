import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      clientPort: 5173,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString()),
  },
  plugins: [
    process.env.NODE_ENV === 'development' && inspectAttr(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'offline.html'],
      manifest: {
        name: 'IKCOUS Marketplace',
        short_name: 'IKCOUS',
        description: 'Marketplace local de Monte Carmelo, MG - Produtos com estoque imediato',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        id: '/?source=pwa',
        start_url: '/?source=pwa',
        launch_handler: {
          client_mode: ['focus-existing', 'auto']
        },
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: [
          "shopping",
          "lifestyle"
        ],
        screenshots: [
          {
            src: '/screenshots/home.png',
            sizes: '750x1334',
            type: 'image/png',
            form_factor: 'narrow'
          }
        ],
        shortcuts: [
          {
            name: "Carrinho",
            short_name: "Carrinho",
            description: "Ver itens no carrinho",
            url: "/?view=cart",
            icons: [
              {
                src: "/icons/cart-96x96.png",
                sizes: "96x96"
              }
            ]
          },
          {
            name: "Favoritos",
            short_name: "Favoritos",
            description: "Ver lista de desejos",
            url: "/?view=favorites",
            icons: [
              {
                src: "/icons/heart-96x96.png",
                sizes: "96x96"
              }
            ]
          }
        ],
        share_target: {
          action: '/',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url'
          }
        }
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
      },
      devOptions: {
        enabled: false,
        type: 'module',
        navigateFallback: 'index.html'
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (normalizedId.includes('commonjsHelpers')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules')) {
            if (normalizedId.includes('react-router-dom') || normalizedId.includes('@remix-run/router')) {
              return 'vendor-router';
            }
            if (normalizedId.includes('embla-carousel-react') || normalizedId.includes('embla-carousel')) {
              return 'vendor-carousel';
            }
            if (normalizedId.includes('react-day-picker') || normalizedId.includes('date-fns')) {
              return 'vendor-date';
            }
            if (
              normalizedId.includes('vaul') ||
              normalizedId.includes('cmdk') ||
              normalizedId.includes('sonner') ||
              normalizedId.includes('canvas-confetti')
            ) {
              return 'vendor-ui-helpers';
            }
            if (normalizedId.includes('react-resizable-panels')) {
              return 'vendor-panels';
            }
            if (normalizedId.includes('react-helmet-async')) {
              return 'vendor-helmet';
            }
            if (normalizedId.includes('lucide-react')) {
              return 'vendor-lucide';
            }
            if (normalizedId.includes('react-hook-form') || normalizedId.includes('zod') || normalizedId.includes('@hookform')) {
              return 'vendor-form';
            }
            if (normalizedId.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            if (normalizedId.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (normalizedId.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (normalizedId.includes('recharts') || normalizedId.includes('d3')) {
              return 'vendor-charts';
            }
            if (
              normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
});

