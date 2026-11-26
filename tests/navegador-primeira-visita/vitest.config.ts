import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config PRÓPRIO da prova em navegador de verdade da primeira visita leve
 * (plano de 26/11/2026). Abre o Chrome do puppeteer contra o build real
 * (`dist-test/`) servido pelo porteiro sintético do CI-PWA
 * (`e2e/pwa-servidor.mjs`). Leva minutos: roda à mão, fora do `test:front` e
 * do job de build do CI. O arquivo é `.prova.ts`, não `.test.ts`, para o
 * `deno test` de `tests/` não o pegar.
 *
 *   IKCOUS_IDENTITY_MODE=fixture npm run build
 *   npx vitest run --config tests/navegador-primeira-visita/vitest.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/navegador-primeira-visita/*.prova.ts"],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
});
