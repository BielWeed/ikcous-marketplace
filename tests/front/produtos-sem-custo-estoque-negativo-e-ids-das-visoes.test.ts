// `src/utils/produtos-sem-custo.ts`: o que os testes vizinhos deixavam passar
// (caça por mutação).
//
//  - `produtoSemCustoEmEstoque`: a regra do banco é estoque MAIOR que zero;
//    estoque negativo (venda que passou do saldo) não entra no selo "sem custo";
//  - os ids das visões são texto combinado entre a tela de Início, o Financeiro
//    e a lista de Produtos (`onNavigate("admin-products", "sem-custo")`): se um
//    lado mudar a grafia sozinho, o atalho abre a lista inteira em vez da visão.
import {
  VISAO_ESTOQUE_BAIXO,
  VISAO_SEM_CUSTO,
  produtoSemCustoEmEstoque,
} from "@/utils/produtos-sem-custo";
import { describe, expect, it } from "vitest";

describe("produtoSemCustoEmEstoque — estoque é 'maior que zero'", () => {
  const base = { isActive: true, costPrice: null as number | null };

  it.each([-1, -40])("estoque negativo (%i) não entra", (stock) => {
    expect(produtoSemCustoEmEstoque({ ...base, stock })).toBe(false);
  });

  it("0 não entra e 1 entra (a fronteira exata)", () => {
    expect(produtoSemCustoEmEstoque({ ...base, stock: 0 })).toBe(false);
    expect(produtoSemCustoEmEstoque({ ...base, stock: 1 })).toBe(true);
  });
});

describe("ids das visões da lista de Produtos", () => {
  it("são os textos combinados com a tela", () => {
    expect(VISAO_SEM_CUSTO).toBe("sem-custo");
    expect(VISAO_ESTOQUE_BAIXO).toBe("estoque-baixo");
  });
});
