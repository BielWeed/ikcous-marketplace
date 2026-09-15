import { defineConfig, devices } from "@playwright/test";

// E2E da frente de expansão da CI (14/09/2026). O alvo é o PREVIEW do build
// fixture ("a loja de ninguém"), a mesma receita sem segredos do job Build
// do ci.yml (`IKCOUS_IDENTITY_MODE=fixture`). Nada de rede externa: o que se
// prova é o artefato que a Vercel recebe boota em navegador de verdade.
//
// No CI (.github/workflows/ci-expansao.yml) o build roda ANTES do
// `npx playwright test`; localmente, faça o mesmo:
//   IKCOUS_IDENTITY_MODE=fixture npm run build
//   npx playwright test
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // E2E oscila por natureza; 2 retries no CI evitam vermelho de ruído de
  // runner (o gate de verdade continua sendo o ci.yml — este job nasce
  // informacional).
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { IKCOUS_IDENTITY_MODE: "fixture" },
  },
});
