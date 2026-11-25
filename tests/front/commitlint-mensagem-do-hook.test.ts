/* eslint-disable security/detect-non-literal-fs-filename -- todos os caminhos nascem de um mkdtemp descartável deste próprio arquivo, nunca de entrada externa. */
// scripts/commitlint-mensagem.mjs — o hook `commit-msg` do lefthook. Se ele
// aprovar o que devia reprovar, uma mensagem fora do padrão entra no histórico
// (aconteceu uma vez, em 06/08/2026: um `git merge --no-ff -m "inválida"`
// validava o COMMIT_EDITMSG do commit ANTERIOR em vez do MERGE_MSG do merge).
//
// O script não tem nenhum outro teste. Aqui ele roda de verdade (Node, sem
// rede) dentro de um repositório git descartável com uma configuração mínima
// do commitlint, e cada caso prova uma decisão dele:
//   - a mensagem do COMMIT_EDITMSG manda quando não há argumento;
//   - com argumento, vale o arquivo nomeado (MERGE_MSG), nunca o COMMIT_EDITMSG;
//   - só o NOME do arquivo conta (caminho com espaço quebrado pelo shell, com
//     `\` ou `/`);
//   - arquivo que não existe reprova (falha fechada);
//   - mensagem válida sai com 0, inválida com status diferente de 0.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/commitlint-mensagem.mjs");
const VALIDA = "feat: mensagem no padrao\n";
const INVALIDA = "isso nao segue o padrao nenhum\n";

let repo = "";

function gravarMensagem(nome: string, texto: string) {
  const arquivo = path.join(repo, ".git", nome);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, texto);
}

function rodar(...argumentos: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...argumentos], {
    cwd: repo,
    encoding: "utf8",
  });
}

beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), "ikcous-commitlint-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  // Configuração mínima e autocontida: sem `extends`, que tentaria resolver
  // um pacote a partir da pasta temporária.
  writeFileSync(
    path.join(repo, ".commitlintrc.json"),
    JSON.stringify({
      rules: {
        "type-empty": [2, "never"],
        "subject-empty": [2, "never"],
        "type-enum": [2, "always", ["feat", "fix"]],
      },
    }),
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("commitlint-mensagem (hook commit-msg)", () => {
  it("sem argumento valida o COMMIT_EDITMSG: mensagem válida sai com 0", () => {
    gravarMensagem("COMMIT_EDITMSG", VALIDA);
    const r = rodar();
    expect(r.error).toBeUndefined();
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 60000);

  it("sem argumento valida o COMMIT_EDITMSG: mensagem inválida reprova (status diferente de 0)", () => {
    gravarMensagem("COMMIT_EDITMSG", INVALIDA);
    const r = rodar();
    expect(r.error).toBeUndefined();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /type may not be empty|subject may not be empty/,
    );
  }, 60000);

  it("com argumento MERGE_MSG valida o MERGE_MSG, não o COMMIT_EDITMSG do commit anterior (a regressão de 06/08)", () => {
    gravarMensagem("COMMIT_EDITMSG", VALIDA);
    gravarMensagem("MERGE_MSG", INVALIDA);
    const r = rodar(path.join(repo, ".git", "MERGE_MSG"));
    expect(
      r.status,
      "merge com mensagem fora do padrão tem de reprovar",
    ).not.toBe(0);
  }, 60000);

  it("com argumento MERGE_MSG válido passa mesmo que o COMMIT_EDITMSG esteja inválido (o argumento manda)", () => {
    gravarMensagem("COMMIT_EDITMSG", INVALIDA);
    gravarMensagem("MERGE_MSG", VALIDA);
    const r = rodar(path.join(repo, ".git", "MERGE_MSG"));
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 60000);

  it("caminho com espaço quebrado pelo shell em vários argumentos: só o último fragmento (o nome do arquivo) conta", () => {
    gravarMensagem("COMMIT_EDITMSG", INVALIDA);
    gravarMensagem("MERGE_MSG", VALIDA);
    const r = rodar(
      "C:\\Users\\alguem\\software",
      "Gerenciador",
      "ecossistema\\.git\\MERGE_MSG",
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const barra = rodar("/tmp/pasta", "com/espaco/.git/MERGE_MSG");
    expect(barra.status, barra.stdout + barra.stderr).toBe(0);
  }, 60000);

  it("arquivo de mensagem que não existe reprova (falha fechada, nunca aprova em silêncio)", () => {
    const r = rodar("SQUASH_MSG");
    expect(r.error).toBeUndefined();
    expect(r.status).not.toBe(0);
  }, 60000);
});
