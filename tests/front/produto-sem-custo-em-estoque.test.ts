// A regra que decide quais produtos entram na contagem do selo "N produtos sem
// custo" da tela Produtos e na lista "Sem custo". É a MESMA do banco
// (`get_admin_analytics_v2`, migration 20261251000000): produto ATIVO e não
// apagado, com custo NULL e estoque efetivo maior que zero. Custo 0 é custo
// zero de propósito (brinde) e NÃO entra; estoque zero e produto pausado, não.
import { mapProductFromDB } from "@/lib/mappers";
import { produtoSemCustoEmEstoque } from "@/utils/produtos-sem-custo";
import { describe, expect, it } from "vitest";

const linha = (extra: Record<string, unknown>) =>
  mapProductFromDB({
    id: "p1",
    nome: "Produto",
    preco_venda: 10,
    estoque: 3,
    ativo: true,
    custo: null,
    ...extra,
  });

describe("produtoSemCustoEmEstoque: a mesma regra do selo, no banco e na lista", () => {
  it("custo vazio, ativo e com estoque entra", () => {
    expect(produtoSemCustoEmEstoque(linha({}))).toBe(true);
  });

  it("custo 0 (brinde de propósito) NÃO entra: sem custo medido é outra coisa", () => {
    expect(produtoSemCustoEmEstoque(linha({ custo: 0 }))).toBe(false);
    expect(produtoSemCustoEmEstoque(linha({ custo: "0" }))).toBe(false);
  });

  it("custo cadastrado não entra", () => {
    expect(produtoSemCustoEmEstoque(linha({ custo: 4.5 }))).toBe(false);
  });

  it("sem estoque não entra (o selo só conta produto em estoque)", () => {
    expect(produtoSemCustoEmEstoque(linha({ estoque: 0 }))).toBe(false);
  });

  it("produto pausado não entra", () => {
    expect(produtoSemCustoEmEstoque(linha({ ativo: false }))).toBe(false);
  });

  it("com variação ativa vale o estoque das variações, não a coluna do pai", () => {
    const grade = (stock: number, active = true) => [
      { id: "v1", product_id: "p1", stock_increment: stock, active },
    ];
    // Pai com estoque 5, mas a única variação ativa está zerada: sem estoque.
    expect(
      produtoSemCustoEmEstoque(
        linha({ estoque: 5, product_variants: grade(0) }),
      ),
    ).toBe(false);
    // Pai zerado, variação ativa com 2: tem estoque.
    expect(
      produtoSemCustoEmEstoque(
        linha({ estoque: 0, product_variants: grade(2) }),
      ),
    ).toBe(true);
    // Variação inativa não conta: volta a valer o estoque do pai.
    expect(
      produtoSemCustoEmEstoque(
        linha({ estoque: 5, product_variants: grade(0, false) }),
      ),
    ).toBe(true);
  });

  it("custo ausente (undefined) vale como sem custo, igual a null", () => {
    expect(
      produtoSemCustoEmEstoque({
        isActive: true,
        stock: 1,
        costPrice: undefined,
      }),
    ).toBe(true);
  });
});
