import { defineConfig, devices } from "@playwright/test";

// Config das JORNADAS E2E (frente e2e-jornadas, 14/09/2026) — arquivo
// SEPARADO de propósito: o `playwright.config.ts` da raiz é território da
// frente expansão-ci (mural glm-expansao-ci-0914) e serve o diretório `e2e/`
// deles. Este arquivo governa SÓ `tests/e2e/jornada-*.spec.ts`, e o workflow
// `.github/workflows/e2e-jornadas.yml` o invoca por `--config`.
//
// Receita de execução (igual ao smoke da expansão-ci: build ANTES do teste):
//   NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture npm run build
//   npx playwright test --config tests/e2e/playwright.jornadas.config.ts
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /jornada-.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // E2E oscila por natureza; 2 retries no CI evitam vermelho de ruído de
  // runner (o gate de verdade continua sendo o ci.yml — este job nasce
  // informacional).
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `cwd` é relativo a ESTE arquivo: o preview roda da raiz do repositório
    // e serve o build fixture que o workflow (ou o passo manual acima) gerou.
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    cwd: "../..",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { IKCOUS_IDENTITY_MODE: "fixture" },
  },
});
