// Título de Devoluções pelo nome único (spec 2026-10-09 painel-simples §2):
// o `titulo` do AdminPageHeader de AdminDevolucoesView vem de
// NOMES_DO_PAINEL["admin-devolucoes"], não de um literal solto — se o nome
// mudar na declaração única, o título acompanha.
/* eslint-disable security/detect-non-literal-fs-filename -- lê um arquivo fixo do próprio repositório, não entrada de usuário */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const fonte = readFileSync(
  join(RAIZ, "src/views/admin/AdminDevolucoesView.tsx"),
  "utf8",
);

describe("AdminDevolucoesView: título pelo nome único", () => {
  it("o título lê NOMES_DO_PAINEL['admin-devolucoes']", () => {
    expect(fonte).toMatch(
      /import\s*\{[^}]*\bNOMES_DO_PAINEL\b[^}]*\}\s*from\s*"@\/config\/nomes-do-painel"/,
    );
    expect(fonte).toMatch(
      /titulo=\{\s*NOMES_DO_PAINEL\["admin-devolucoes"\]\s*\}/,
    );
  });

  it("não sobra o título literal", () => {
    expect(fonte).not.toMatch(/titulo="Devoluções"/);
  });
});
