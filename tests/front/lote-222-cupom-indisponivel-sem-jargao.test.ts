// Lote 222 (M7): a caixa "Cupom indisponível" não fala em "chave" (o
// interruptor Ativo/Inativo é coisa de quem programa) e diz o que houve.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync("src/views/admin/AdminCouponsView.tsx", "utf8");

describe("lote 222 — Cupom indisponível em português simples", () => {
  it("sem 'A chave está ligada'", () => {
    expect(fonte).not.toContain("A chave está ligada");
  });
  it("as duas variantes dizem o que houve e o que ajustar", () => {
    expect(fonte).toContain(
      "O cupom está ativo, mas expirou. Ajuste a validade para ele voltar a valer.",
    );
    expect(fonte).toContain(
      "O cupom está ativo, mas esgotou. Ajuste o limite de uso para ele voltar a valer.",
    );
  });
});
