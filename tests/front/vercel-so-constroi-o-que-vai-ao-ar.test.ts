// A Vercel do plano gratuito aceita 100 deploys a cada 24 h. Cada push em branch de PR criava uma
// prévia que ninguém usa (nenhum teste do CI depende dela) e, em 15/10/2026, isso comeu as vagas e a
// Vercel recusou o candidato da release 1.5.29. `git.deploymentEnabled` desliga a prévia dos PRs
// (`claude/*`) e mantém a branch principal e a `production`. Regra da doc: se a branch bate em mais
// de um padrão e algum é `true`, ela faz deploy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BRANCH_PRINCIPAL = "claude/app-major-upgrade-wmc8x2";
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  git?: { deploymentEnabled?: Record<string, boolean> | boolean };
};
const regras = config.git?.deploymentEnabled;

// Só o que o vercel.json usa: nenhum `*` (nome exato) ou um `*` = texto dentro de um trecho do caminho
// (minimatch). Dois `*` ou outro curinga reprovam aqui em vez de virar aproximação em silêncio.
function casa(padrao: string, branch: string) {
  const partes = padrao.split("*");
  if (partes.length > 2 || /[?[\]{}()!]/.test(padrao)) {
    throw new Error(
      `padrão de branch fora do que este teste entende: ${padrao}`,
    );
  }
  if (partes.length === 1) return padrao === branch;
  const [prefixo, sufixo] = partes;
  if (!branch.startsWith(prefixo) || !branch.endsWith(sufixo)) return false;
  if (branch.length < prefixo.length + sufixo.length) return false;
  return !branch
    .slice(prefixo.length, branch.length - sufixo.length)
    .includes("/");
}

function fazDeploy(branch: string) {
  if (typeof regras !== "object") return regras !== false;
  const batidas = Object.entries(regras).filter(([p]) => casa(p, branch));
  if (batidas.length === 0) return true; // o padrão da Vercel é `true`
  return batidas.some(([, ligado]) => ligado);
}

describe("vercel.json — só constrói o que vai ao ar", () => {
  it("a branch principal e a production seguem fazendo deploy", () => {
    expect(fazDeploy(BRANCH_PRINCIPAL)).toBe(true);
    expect(fazDeploy("production")).toBe(true);
    expect(fazDeploy("main")).toBe(true);
  });

  it("branch de PR (claude/…) não gera prévia", () => {
    expect(fazDeploy("claude/painel-mais-leve-20261015")).toBe(false);
    expect(fazDeploy("claude/custo-do-dia-em-cada-venda-20261015")).toBe(false);
  });

  it("o desligamento é por padrão de branch, nunca global", () => {
    expect(typeof regras).toBe("object");
    expect(regras).not.toBeNull();
  });
});
