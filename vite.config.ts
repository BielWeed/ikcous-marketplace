import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { inspectAttr } from "kimi-plugin-inspect-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

// Carregamento dinâmico de branding.json
let branding = {
  appName: "IKCOUS Marketplace",
  companyName: "IKCOUS",
  theme: {
    primary: "#18181b",
    secondary: "#18181b",
    accent: "#6366F1",
  },
  supportContact: "",
};

try {
  const brandingPath = path.resolve(__dirname, "src/config/branding.json");
  if (fs.existsSync(brandingPath)) {
    branding = JSON.parse(fs.readFileSync(brandingPath, "utf-8"));
  }
} catch (e) {
  console.warn("Aviso ao carregar branding.json:", e);
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const isDev = mode === "development";
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  const buildTime = new Date().toISOString();

  const appVersion = isDev
    ? `${packageJson.version}-dev`
    : gitSha
      ? `${packageJson.version}-sha.${gitSha.slice(0, 7)}`
      : `${packageJson.version}-build.${Date.now().toString().slice(-5)}`;

  console.log(`[PWA Build] Version determined: ${appVersion}`);

  const pwaVersionPlugin = {
    name: "pwa-version-generator",
    writeBundle() {
      const distPath = path.resolve(process.cwd(), "dist");
      const versionJsonPath = path.resolve(distPath, "version.json");
      const versionData = {
        version: appVersion,
        buildDate: buildTime,
        etag: gitSha || Date.now().toString(),
        swVersion: `v${packageJson.version}`,
      };

      try {
        if (!fs.existsSync(distPath)) {
          fs.mkdirSync(distPath, { recursive: true });
        }
        fs.writeFileSync(
          versionJsonPath,
          JSON.stringify(versionData, null, 2),
          "utf-8",
        );
        console.log(
          `[PWA Version Plugin] Generated version.json with version: ${appVersion}`,
        );
      } catch (err) {
        console.error(
          "[PWA Version Plugin] Failed to generate version.json:",
          err,
        );
      }

      const silentGuardianPath = path.resolve(distPath, "silent-guardian.js");
      try {
        if (fs.existsSync(silentGuardianPath)) {
          let content = fs.readFileSync(silentGuardianPath, "utf-8");
          content = content.replace(
            /"1773003981700"/g,
            JSON.stringify(appVersion),
          );
          fs.writeFileSync(silentGuardianPath, content, "utf-8");
          console.log(
            `[PWA Version Plugin] Updated silent-guardian.js with version: ${appVersion}`,
          );
        }
      } catch (err) {
        console.error(
          "[PWA Version Plugin] Failed to update silent-guardian.js:",
          err,
        );
      }
    },
  };

  // Conversor de hex para rgb
  function hexToRgb(hexStr: string) {
    let hex = hexStr.replace(/^#/, "");
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const num = Number.parseInt(hex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  const rgbPrimary = hexToRgb(branding.theme?.primary || "#18181b");
  const rgbSecondary = hexToRgb(branding.theme?.secondary || "#18181b");
  const rgbAccent = hexToRgb(branding.theme?.accent || "#6366F1");

  return {
    base: "/",
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
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      pwaVersionPlugin,
      process.env.ANALYZE === "true" &&
        visualizer({
          emitFile: false,
          filename: "dist/stats.html",
          open: true,
        }),
      process.env.NODE_ENV === "development" && inspectAttr(),
      react(),
      {
        name: "html-branding-transform",
        transformIndexHtml(html: string) {
          const appName = branding.appName || "IKCOUS Marketplace";
          const firstLetter = appName.trim().charAt(0).toUpperCase();
          const shortAppName = appName.split(" - ")[0].trim();

          const description =
            (branding as any).description ||
            `${appName} - O seu shopping local completo. Descubra produtos incríveis com entrega super rápida e frete grátis!`;

          const supabaseUrl = env.VITE_SUPABASE_URL || "";
          const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
          const appUrl =
            env.VITE_APP_URL ||
            (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : "https://ickous-marketplace.vercel.app");

          let customizedHtml = html;

          // Substitui title
          customizedHtml = customizedHtml.replace(
            /<title>.*?<\/title>/g,
            `<title>${appName} | Monte Carmelo, MG</title>`,
          );

          // Substitui description
          customizedHtml = customizedHtml.replace(
            /<meta name="description" content=".*?" \/>/g,
            `<meta name="description" content="${description}" />`,
          );

          // Substitui apple-mobile-web-app-title
          customizedHtml = customizedHtml.replace(
            /<meta name="apple-mobile-web-app-title" content=".*?" \/>/g,
            `<meta name="apple-mobile-web-app-title" content="${shortAppName}" />`,
          );

          // Substitui application-name
          customizedHtml = customizedHtml.replace(
            /<meta name="application-name" content=".*?" \/>/g,
            `<meta name="application-name" content="${shortAppName}" />`,
          );

          // Substitui as tags OG e Twitter
          customizedHtml = customizedHtml.replace(
            /<meta property="og:title" content=".*?" \/>/g,
            `<meta property="og:title" content="${appName}" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta property="og:description" content=".*?" \/>/g,
            `<meta property="og:description" content="${description}" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta property="og:url" content=".*?" \/>/g,
            `<meta property="og:url" content="${appUrl}/" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta property="og:image" content=".*?" \/>/g,
            `<meta property="og:image" content="${appUrl}/og-image.png" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta name="twitter:title" content=".*?" \/>/g,
            `<meta name="twitter:title" content="${appName}" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta name="twitter:description" content=".*?" \/>/g,
            `<meta name="twitter:description" content="${description}" />`,
          );
          customizedHtml = customizedHtml.replace(
            /<meta name="twitter:image" content=".*?" \/>/g,
            `<meta name="twitter:image" content="${appUrl}/og-image.png" />`,
          );

          // Substitui o link de preconnect do Supabase
          if (supabaseOrigin) {
            customizedHtml = customizedHtml.replace(
              /<link rel="preconnect" href="https:\/\/.*?\.supabase\.co" crossorigin \/>/g,
              `<link rel="preconnect" href="${supabaseOrigin}" crossorigin />`,
            );
          }

          // Carrega logotipo dinamicamente no loader
          let logoHtml = "";
          if (fs.existsSync(path.resolve(process.cwd(), "public/logo.svg"))) {
            logoHtml = `<img src="/logo.svg" alt="${shortAppName}" class="guardian-logo" />`;
          } else if (
            fs.existsSync(
              path.resolve(process.cwd(), "public/branding/logo.png"),
            )
          ) {
            logoHtml = `<img src="/branding/logo.png" alt="${shortAppName}" class="guardian-logo" />`;
          } else {
            logoHtml = `
          <div class="guardian-logo-icon">
            <span>${firstLetter}</span>
          </div>
          <span class="guardian-brand-text">${shortAppName}</span>`;
          }

          customizedHtml = customizedHtml.replace(
            /<!-- LOGO_START -->[\s\S]*?<!-- LOGO_END -->/g,
            logoHtml,
          );

          // Injeta as variáveis de CSS dinâmicas para o loader
          const styleTag = `
  <style id="dynamic-branding-style">
    :root {
      --primary-color: ${branding.theme?.primary || "#18181b"};
      --secondary-color: ${branding.theme?.secondary || "#18181b"};
      --accent-color: ${branding.theme?.accent || "#6366F1"};
      --orb-1-color: rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.25);
      --orb-2-color: rgba(${rgbSecondary.r}, ${rgbSecondary.g}, ${rgbSecondary.b}, 0.20);
      --orb-3-color: rgba(${rgbAccent.r}, ${rgbAccent.g}, ${rgbAccent.b}, 0.20);
      --progress-track-color: rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.15);
    }
  </style>
`;
          customizedHtml = customizedHtml.replace(
            /<head>/,
            `<head>${styleTag}`,
          );

          return customizedHtml;
        },
      },
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src/sw",
        filename: "sw.ts",
        registerType: "prompt",
        includeAssets: [
          "favicon.ico",
          "apple-touch-icon.png",
          "mask-icon.svg",
          "offline.html",
        ],
        manifest: {
          name: branding.appName,
          short_name: branding.appName.split(" - ")[0].trim(),
          description:
            (branding as any).description ||
            `${branding.appName} - O seu shopping local completo`,
          theme_color: branding.theme?.primary || "#18181b",
          background_color: branding.theme?.primary || "#18181b",
          display: "standalone",
          orientation: "portrait",
          scope: "/",
          id: "/?source=pwa",
          start_url: "/?source=pwa",
          launch_handler: {
            client_mode: ["focus-existing", "auto"],
          },
          icons: [
            {
              src: "icons/icon-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "icons/icon-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          categories: ["shopping", "lifestyle"],
          screenshots: [
            {
              src: "/screenshots/home.png",
              sizes: "750x1334",
              type: "image/png",
              form_factor: "narrow",
            },
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
                  sizes: "96x96",
                },
              ],
            },
            {
              name: "Favoritos",
              short_name: "Favoritos",
              description: "Ver lista de desejos",
              url: "/?view=favorites",
              icons: [
                {
                  src: "/icons/heart-96x96.png",
                  sizes: "96x96",
                },
              ],
            },
          ],
          share_target: {
            action: "/",
            method: "GET",
            enctype: "application/x-www-form-urlencoded",
            params: {
              title: "title",
              text: "text",
              url: "url",
            },
          },
        },
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
          // O precache é baixado inteiro no primeiro acesso, inclusive em 4G.
          // Sem estes ignores ele passava de 6,5 MB, dos quais ~5 MB nenhum
          // cliente comum chega a usar. Os chunks do admin continuam disponíveis:
          // saem do precache e passam a ser buscados sob demanda pela rede.
          globIgnores: [
            // Fotos de um template antigo, sem nenhuma referência no código (~3,2 MB).
            "images/demo/**",
            // Só é lida por crawler de link (WhatsApp, Google); o app nunca busca (~670 kB).
            "og-image.png",
            // Telas exclusivas da área administrativa (~1,2 MB).
            "assets/Admin*.js",
            "assets/vendor-charts-*.js",
            "assets/ImageAdjuster-*.js",
            "assets/PhoneSimulator-*.js",
          ],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
          type: "module",
          navigateFallback: "index.html",
        },
      }),
    ].filter(Boolean) as any,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");
            if (normalizedId.includes("commonjsHelpers")) {
              return "vendor-react";
            }
            if (id.includes("node_modules")) {
              if (
                normalizedId.includes("react-router-dom") ||
                normalizedId.includes("@remix-run/router")
              ) {
                return "vendor-router";
              }
              if (
                normalizedId.includes("embla-carousel-react") ||
                normalizedId.includes("embla-carousel")
              ) {
                return "vendor-carousel";
              }
              if (
                normalizedId.includes("react-day-picker") ||
                normalizedId.includes("date-fns")
              ) {
                return "vendor-date";
              }
              if (
                normalizedId.includes("vaul") ||
                normalizedId.includes("cmdk") ||
                normalizedId.includes("sonner") ||
                normalizedId.includes("canvas-confetti")
              ) {
                return "vendor-ui-helpers";
              }
              if (normalizedId.includes("react-resizable-panels")) {
                return "vendor-panels";
              }
              if (normalizedId.includes("lucide-react")) {
                return "vendor-lucide";
              }
              if (
                normalizedId.includes("react-hook-form") ||
                normalizedId.includes("zod") ||
                normalizedId.includes("@hookform")
              ) {
                return "vendor-form";
              }
              if (normalizedId.includes("@radix-ui")) {
                return "vendor-radix";
              }
              if (normalizedId.includes("framer-motion")) {
                return "vendor-motion";
              }
              if (normalizedId.includes("@supabase")) {
                return "vendor-supabase";
              }
              if (
                normalizedId.includes("recharts") ||
                normalizedId.includes("d3")
              ) {
                return "vendor-charts";
              }
              if (
                normalizedId.includes("/node_modules/react/") ||
                normalizedId.includes("/node_modules/react-dom/") ||
                normalizedId.includes("/node_modules/scheduler/")
              ) {
                return "vendor-react";
              }
            }
          },
        },
      },
    },
  };
});
