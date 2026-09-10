import { describe, expect, it } from "vitest";
// Módulo JS sem declaração de tipos, mesmo padrão de store-delivery-contract.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração; confronto com o contrato TypeScript.
import * as hospedagem from "../../scripts/hospedagem.mjs";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

describe("rotas da hospedagem", () => {
  it("o espelho JS é igual à declaração única, na mesma ordem", () => {
    expect([...hospedagem.telasDeEntrada]).toEqual([...TELAS_DE_ENTRADA]);
  });

  it("controle negativo: uma tela a menos derruba o confronto", () => {
    expect([...hospedagem.telasDeEntrada].slice(1)).not.toEqual([
      ...TELAS_DE_ENTRADA,
    ]);
  });

  it("54 formas: 36 nominais + 18 aliases admin/<x>, ordenadas", () => {
    const formas = hospedagem.formasDeEntrada();
    expect(formas).toHaveLength(54);
    expect(formas).toEqual([...formas].sort());
    expect(formas).toContain("/admin/orders");
    expect(formas).toContain("/admin-orders");
    expect(formas).toContain("/home");
    expect(formas).not.toContain("/");
    expect(formas).not.toContain("/admin/"); // "admin" não ganha alias
  });

  it("_redirects tem 108 regras, cada forma com e sem barra final, alvo raiz 200", () => {
    const texto = hospedagem.redirects();
    expect(texto.endsWith("\n")).toBe(true);
    const linhas = texto.trimEnd().split("\n");
    expect(linhas).toHaveLength(108);
    expect(linhas).toContain("/admin/orders / 200");
    expect(linhas).toContain("/admin/orders/ / 200");
    expect(linhas).toContain("/product-detail / 200");
    expect(linhas).not.toContain("/ / 200");
    for (const linha of linhas)
      expect(linha).toMatch(
        /^\/[a-z-]+\/? \/ 200$|^\/[a-z-]+\/[a-z-]+\/? \/ 200$/,
      );
  });

  it("_routes.json é exatamente o do ensaio A7a3", () => {
    expect(JSON.parse(hospedagem.routes())).toEqual({
      version: 1,
      include: ["/product-detail"],
      exclude: [],
    });
    expect(hospedagem.routes().endsWith("\n")).toBe(true);
  });
});
