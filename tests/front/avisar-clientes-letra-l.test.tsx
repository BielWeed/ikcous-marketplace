// Onda L · frente "avisar-clientes" — prova ESTÁTICA (lê o fonte; o jsdom não
// aplica CSS, então a medida de verdade — a prévia da notificação a 360px, os
// selos e as pílulas com 11px — é a do render do integrador).
//
// A tela Avisar clientes (Push) não tem texto abaixo de 11px: a régua do painel
// conta `text-[6px]` … `text-[10.5px]` (inclusive com prefixo, `sm:text-[10px]`).
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê o arquivo-fonte do próprio repositório (caminho constante deste teste, não entrada de usuário); regex constante, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ARQUIVO = join(
  __dirname,
  "..",
  "..",
  "src/views/admin/AdminPushView.tsx",
);

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

const PEQUENO = /text-\[(?:[0-9]|10)(?:\.\d+)?px\]/g;

describe("Avisar clientes (Push) sem texto abaixo de 11px", () => {
  const fonte = semComentarios(readFileSync(ARQUIVO, "utf8"));

  it("nenhum text-[0px … 10.5px] fora de comentário", () => {
    const pequenos = fonte
      .split("\n")
      .flatMap((linha, i) =>
        (linha.match(PEQUENO) ?? []).map((m) => `linha ${i + 1}: ${m}`),
      );
    expect(pequenos).toEqual([]);
  });

  it("a prévia da notificação do aparelho (9.5px) também subiu para 11px", () => {
    expect(fonte).not.toMatch(/text-\[9\.5px\]/);
    expect(fonte).toMatch(/text-\[11px\]/);
  });
});
