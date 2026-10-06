import path from "node:path";
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

// RODADA (04/10/2026, revisão de risco das jornadas de pagamento): cada
// execução ganha um identificador próprio, e com ele uma pasta de saída e um
// log do servidor de preview SÓ DELA — uma rodada vermelha nunca mais é
// sobrescrita pela verde seguinte. O `??=` grava no ambiente do processo
// principal ANTES de os workers nascerem: eles herdam o MESMO valor.
const RODADA = (process.env.IKCOUS_E2E_RODADA ??= new Date()
  .toISOString()
  .replace(/[:.]/g, "-"));
const RAIZ = path.resolve(import.meta.dirname, "../..");

// As jornadas de PAGAMENTO são teste de dinheiro: sem retry nenhum (um
// vermelho é um achado, nunca ruído a absorver) e num projeto próprio.
const JORNADAS_DE_PAGAMENTO = /jornada-pagamento-.*\.spec\.ts/;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /jornada-.*\.spec\.ts/,
  // Dentro de `test-results/` (o workflow sobe essa pasta inteira como
  // artefato), uma subpasta por rodada.
  outputDir: path.join(RAIZ, "test-results", `jornadas-${RODADA}`),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // E2E oscila por natureza; 2 retries no CI evitam vermelho de ruído de
  // runner (o gate de verdade continua sendo o ci.yml — este job nasce
  // informacional). NÃO vale para o projeto "pagamentos" (retries 0, abaixo).
  retries: process.env.CI ? 2 : 0,
  // UM worker, declarado: as jornadas dividem um único servidor de preview e
  // a porta 4173 (a ficha da loja exige esse host).
  workers: 1,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Evidência de falha: trace (rede, DOM, console) e tela. Só os mocks das
    // jornadas aparecem ali — chave pública e sessão FICTÍCIAS dos kits.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Requisição feita pelo service worker não passa pelas rotas da página
    // (a guarda de rede dos kits não a veria): SW bloqueado em toda jornada.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: JORNADAS_DE_PAGAMENTO,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pagamentos",
      testMatch: JORNADAS_DE_PAGAMENTO,
      retries: 0,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `cwd` é relativo a ESTE arquivo: o preview roda da raiz do repositório
    // e serve o build fixture que o workflow (ou o passo manual acima) gerou.
    // O lançador grava o log do servidor em
    // `test-results/preview-logs/preview-<rodada>.log` (ver o arquivo).
    command: "node tests/e2e/servidor-preview-com-registro.mjs",
    url: "http://127.0.0.1:4173",
    cwd: "../..",
    // NUNCA reaproveitar um servidor que já esteja na porta: ele pode ser de
    // OUTRA cópia do repositório (outra worktree, outro build) — a jornada
    // rodaria contra código que não é o desta árvore, sem log. Porta ocupada
    // vira erro explícito na largada.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { IKCOUS_IDENTITY_MODE: "fixture", IKCOUS_E2E_RODADA: RODADA },
  },
});
