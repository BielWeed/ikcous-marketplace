// A Vercel do plano gratuito aceita 100 deploys a cada 24 h. Cada push em branch de PR criava uma
// prévia automática e, em 15/10/2026, isso comeu as vagas e a Vercel recusou o candidato da release
// 1.5.29. `git.deploymentEnabled` desliga a prévia das famílias de branch de PR e mantém a branch
// principal, a `production`, a `main`, a `develop`, `release/*` e `hotfix/*`. Regra da doc: se a
// branch bate em mais de um padrão e algum é `true`, ela faz deploy; branch que não bate em nenhum
// padrão faz deploy (padrão da Vercel). Preview de PR passa a ser sob demanda (DEFINITION-OF-DONE, item 4).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BRANCH_PRINCIPAL = "claude/app-major-upgrade-wmc8x2";
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  git?: { deploymentEnabled?: Record<string, boolean> | boolean };
};
const regras = config.git?.deploymentEnabled;

// Só o que o vercel.json usa: nome exato, `prefixo/*` (um trecho) e `prefixo/**` (qualquer profundidade).
// Outro curinga reprova aqui em vez de virar aproximação em silêncio.
function casa(padrao: string, branch: string) {
  if (/[?[\]{}()!]/.test(padrao)) {
    throw new Error(
      `padrão de branch fora do que este teste entende: ${padrao}`,
    );
  }
  if (padrao.endsWith("/**")) return branch.startsWith(padrao.slice(0, -2));
  if (padrao.endsWith("/*")) {
    const prefixo = padrao.slice(0, -1);
    return (
      branch.startsWith(prefixo) &&
      branch.length > prefixo.length &&
      !branch.slice(prefixo.length).includes("/")
    );
  }
  if (padrao.includes("*")) {
    throw new Error(
      `padrão de branch fora do que este teste entende: ${padrao}`,
    );
  }
  return padrao === branch;
}

function fazDeploy(branch: string) {
  if (typeof regras !== "object") return regras !== false;
  const batidas = Object.entries(regras).filter(([p]) => casa(p, branch));
  if (batidas.length === 0) return true; // o padrão da Vercel é `true`
  return batidas.some(([, ligado]) => ligado);
}

describe("vercel.json — só constrói o que vai ao ar", () => {
  it("a branch principal e as de integração seguem fazendo deploy", () => {
    for (const branch of [
      BRANCH_PRINCIPAL,
      "production",
      "main",
      "develop",
      "release/1.6.0",
      "hotfix/frete-zerado",
    ]) {
      expect(fazDeploy(branch), branch).toBe(true);
    }
  });

  it("toda família de branch de PR deixa de gerar prévia, mesmo com barras dentro", () => {
    for (const branch of [
      "claude/painel-mais-leve-20261015",
      "claude/custo-do-dia-em-cada-venda-20261015",
      "feat/carrinho",
      "fix/frete",
      "fix/frete/cep-invertido",
      "chore/deps",
      "docs/runbook",
      "refactor/pedidos",
      "dependabot/npm_and_yarn/vite-7.3.7",
      "codex/painel-do-lojista",
      "infra/dns",
      "ci/cache-do-vitest",
      "rollback/1.5.28",
      "hermes/rodada",
      "glm/revisao",
      "diag/frete/cep",
      "a11y/foco-do-modal",
      "test/flaky-timing",
      "teste/convergencia-acl",
      "verify/release",
      "ops/limpeza",
      "perf/vitrine",
      "build/vite",
      "style/botoes",
      "revert/pr-900",
      "pii/main",
      "review/pix-checkout",
      "db/og-so-png",
      "cupons/checkout",
      "balcao/pix",
      "limpeza/pii/dados",
      "mapa/vetor",
      "pr/905",
    ]) {
      expect(fazDeploy(branch), branch).toBe(false);
    }
  });

  it("o desligamento é por padrão de branch, nunca global", () => {
    expect(typeof regras).toBe("object");
    expect(regras).not.toBeNull();
  });
});
