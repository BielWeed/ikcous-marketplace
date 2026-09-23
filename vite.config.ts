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
      // wasm: o binário do leitor de código de barras do balcão (C2) —
      // precisa estar disponível offline, senão o balcão para de ler.
      globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2,wasm}"],
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
      // A tela do balcão precisa estar no precache (vender offline é o
      // ponto): com o nome padrão ela nasceria `assets/AdminPdvView-<hash>.js`
      // e cairia na exclusão `assets/Admin*.js` do globIgnores do
      // injectManifest. Se o lote C3 mudar o caminho do arquivo, mude aqui
      // junto — o Map casa por caminho absoluto.
      ["src/views/admin/AdminPdvView.tsx", "PdvBalcao"],
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
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        // O recharts importa 29 funções `lodash/<nome>` na versão CommonJS:
        // 263 módulos, cada um embrulhado pelo plugin commonjs. A MESMA versão
        // em ES module (lodash-es, mesma 4.18.1 do lodash que o recharts
        // resolve) sai sem os embrulhos: vendor-charts -3,2 kB brotli no build
        // fixture de 23/09/2026 (entrega 804,34 -> 801,16 kB, teto D8 de 800).
        // Só o recharts importa `lodash/` (e o lodash-es cai no vendor-charts,
        // fora do boot); o `lodash` raiz não casa com a regex.
        { find: /^lodash\/(.*)$/, replacement: "lodash-es/$1" },
      ],
    },
    build: {
      outDir: identity.outDir,
      // Terser em vez do esbuild default: a entrega brotli somada caiu de
      // 803,52 kB para 780,72 kB no build fixture (20/09/2026, teto de 800
      // do size-limit). Presets seguros — sem drop_console, sem pure_funcs,
      // sem unsafe; target e divisão de chunks preservados.
      minify: "terser",
      // Segunda passada do compress (opção segura, sem `unsafe`): -1,1 kB
      // brotli na entrega somada (23/09/2026).
      terserOptions: { compress: { passes: 2 } },
      rollupOptions: {
        output: {
          // Chunks menores que 2 kB (antes de comprimir) são fundidos num
          // vizinho — o Rollup só funde quando não muda o que executa ao
          // carregar cada entrada. Eram 53 arquivos < 2 kB brotli pagando
          // cabeçalho de import/export cada um: -3,8 kB na entrega somada e
          // o boot do cliente NÃO cresce (234,87 -> 234,66 kB brotli, fixture
          // de 23/09/2026). De brinde, o PdvBalcao deixou de importar
          // estaticamente o `AdminPageHeader-*.js`, que o globIgnores
          // `assets/Admin*.js` tira do precache (balcão offline).
          experimentalMinChunkSize: 2000,
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
              if (normalizedId.includes("zxing-wasm")) {
                // O leitor do balcão: chunk com nome PRÓPRIO para (1) entrar
                // no precache (a exclusão de vite.config.ts é
                // `assets/Admin*.js`) e (2) ser um arquivo previsível no
                // `npm run size`. Continua preguiçoso: só o import() do
                // fallback (C2.5) o referencia.
                return "leitor-zxing";
              }
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
                normalizedId.includes("clsx") ||
                normalizedId.includes("tailwind-merge") ||
                normalizedId.includes("class-variance-authority") ||
                normalizedId.includes("vaul") ||
                normalizedId.includes("cmdk") ||
                normalizedId.includes("sonner") ||
                normalizedId.includes("canvas-confetti")
              ) {
                // vite-214 (A12.3): clsx/tailwind-merge/cva classificados
                // AQUI de propósito. Sem regra, o Rollup funde o clsx no
                // chunk do primeiro importador pesado — o recharts (vendor-
                // charts) — e o `cn()` de src/lib/utils.ts arrastava 92 kB
                // brotli de biblioteca de gráfico para o boot de todo
                // cliente da vitrine (modulepreload no index.html). Este
                // vendor já é estático na entrada: zero requisição nova.
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
