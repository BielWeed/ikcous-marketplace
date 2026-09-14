import { defineConfig, devices } from "@playwright/test";
import { caminhoDaFichaNoTemp } from "./pwa-kit";

// Config do CI-PWA (frente ci-pwa, 14/09/2026) — arquivo SEPARADO de
// propósito, como o playwright.jornadas.config.ts: o `playwright.config.ts`
// da raiz é território da frente expansão-ci (mural glm-expansao-ci-0914) e
// este arquivo governa SÓ `e2e/pwa-*.spec.ts`. PROPOSTA registrada na mesa:
// quando o config da raiz mergear, adicionar testIgnore para pwa-*.spec.ts
// (convivência, decisão da expansão-ci).
//
// Receita de execução (igual ao ci.yml/jornadas: build ANTES do teste — e a
// frente PWA precisa de DOIS builds para o fluxo de atualização v1→v2):
//   NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture IKCOUS_CODE_SHA=<40-hex> npm run build
//   mover dist-test para dist-v1  (e repetir com OUTRO SHA para dist-v2)
//   npx playwright test --config e2e/pwa-playwright.config.ts
export default defineConfig({
  // Grava a ficha da loja fixture no arquivo único em temp ANTES do
  // webServer subir (o servidor não importa TS — lê o arquivo pronto).
  globalSetup: "./pwa-global-setup.ts",
  testDir: import.meta.dirname,
  testMatch: /pwa-.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    // O main.tsx DESLIGA o registro de service worker quando o UA contém
    // "headless" ou "playwright" (bypass de sandbox para o jsdom). O UA
    // nativo do headless shell contém "HeadlessChrome" — sem este override
    // NENHUM critério desta frente é provável. O device "Desktop Chrome"
    // já traz UA limpo; cravar de novo é defesa explícita.
    userAgent: devices["Desktop Chrome"].userAgent,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Servidor PRÓPRIO da frente (e2e/pwa-servidor.mjs): serve o dist como
    // o porteiro serviria (ficha no HTML + /identidade.json + /version.json
    // do dist) e aceita trocar de dist / "sumir" com arquivo EM RUNTIME —
    // é o que reproduz deploy v1→v2 e chunk sumido para o SW real, que o
    // page.route não alcança. Porta 4174: própria, fora das 5173-75.
    command: "node e2e/pwa-servidor.mjs",
    url: "http://127.0.0.1:4174/__pwa__/estado",
    cwd: "..",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PWA_FICHA_ARQ: caminhoDaFichaNoTemp(),
      PWA_PASTA_DISTS: process.cwd(),
      PWA_PORTA: "4174",
    },
  },
});
