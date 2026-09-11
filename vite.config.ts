import path from "node:path";
import react from "@vitejs/plugin-react";
import { inspectAttr } from "kimi-plugin-inspect-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";
import type { UserConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { MANIFESTO_BASE } from "./src/config/manifestoBase";
// Endereço público de CADA loja — MESMO corpo de `resolverEnderecoPublico`
// em middleware.ts (docstring completa lá). Duplicado, não importado: um
// `import { resolverEnderecoPublico } from "./middleware.ts"` aqui puxa
// middleware.ts para o programa de `tsconfig.node.json`, e `tsc -b --force`
// reprova com TS2559 ("Type 'ProcessEnv' has no properties in common with
// type ...") — a checagem de "weak type" do TypeScript não conta o índice de
// `ProcessEnv` como propriedade em comum com um tipo só de campos opcionais.
// Medido em 08/09/2026 tentando a importação antes de duplicar.
type AmbienteEnderecoPublico = {
  VITE_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
};

export function resolverEnderecoPublico(env: AmbienteEnderecoPublico): string {
  const candidatos = [
    env.VITE_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];

  for (const candidato of candidatos) {
    const valor = (candidato ?? "").trim();
    if (valor === "") continue;
    const comProtocolo = /^https?:\/\//.test(valor)
      ? valor
      : `https://${valor}`;
    return comProtocolo.replace(/\/+$/, "");
  }

  return "https://ickous-marketplace.vercel.app";
}

export default defineConfig(async (context): Promise<UserConfig> => {
  const { mode, command, isPreview } = context;
  const root = process.cwd();
  const env = loadEnv(mode, root, "");
  const { createIdentityBuildConfig } = await import(
    "./scripts/identityBuildConfig"
  );
  const pwaOptions: Partial<VitePWAOptions> = {
    strategies: "injectManifest",
    srcDir: "src/sw",
    filename: "sw.ts",
    registerType: "prompt",
    manifest: {
      name: "",
      short_name: "",
      // Campos que NUNCA variam por loja — ponto único de troca com o
      // manifest que o porteiro monta em tempo real
      // (`src/hospedagem/porteiro.ts`, `src/config/manifestoBase.ts`).
      ...MANIFESTO_BASE,
      icons: [],
    },
    injectManifest: {
      globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
      // Identity resources are added explicitly by role, including JPEG.
      // Originals and OG stay available but are not downloaded at installation.
      globIgnores: [
        "store-identity/**",
        "images/demo/**",
        "og-image.png",
        "assets/Admin*.js",
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
  };
  const identity = createIdentityBuildConfig({
    env,
    context,
    root,
    resolvePublicAddress: resolverEnderecoPublico,
    pwaOptions,
  });
  // Preview only serves an already built delivery; it must not prepare another one.
  if (isPreview)
    return {
      base: "/",
      build: { outDir: identity.outDir },
      plugins: [identity.plugin],
    };
  // Closed set of measured dynamic entries; shared chunks retain Vite names.
  const identityEntries = new Map(
    [
      [
        "src/components/admin/settings/IdentitySettingsSection.tsx",
        "AdminIdentitySettings",
      ],
      ["src/lib/prepareIdentityImage.ts", "AdminIdentityPrepare"],
      ["src/lib/uploadIdentityImage.ts", "AdminIdentityUpload"],
      [
        "node_modules/tus-js-client/lib.esm/browser/index.js",
        "AdminIdentityTus",
      ],
      ["node_modules/image-dimensions/index.js", "AdminIdentityDimensions"],
    ].map(([file, name]) => [
      path.resolve(root, file).replace(/\\/g, "/"),
      name,
    ]),
  );
  const isDev = mode === "development";
  if (command === "build" && !isDev) process.env.NODE_ENV = "production";
  return {
    base: "/",
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      hmr: { clientPort: 5173 },
    },
    plugins: [
      identity.plugin,
      ...(process.env.ANALYZE === "true"
        ? [
            visualizer({
              emitFile: false,
              filename: `${identity.outDir}/stats.html`,
              open: true,
            }),
          ]
        : []),
      ...(isDev ? [inspectAttr()] : []),
      react(),
      VitePWA(pwaOptions),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: identity.outDir,
      rollupOptions: {
        output: {
          chunkFileNames(chunk) {
            const id = chunk.facadeModuleId?.replace(/\\/g, "/");
            const name =
              chunk.isDynamicEntry && id ? identityEntries.get(id) : undefined;
            return name
              ? `assets/${name}-[hash].js`
              : "assets/[name]-[hash].js";
          },
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
