// A cliente busca "38" e o 38 esta zerado: o produto nao pode aparecer como se
// tivesse o tamanho. Para o termo casar com uma VARIACAO, ela precisa estar
// ligada E com estoque (o mesmo `stockIncrement > 0` da vitrine,
// preco-de-vitrine.ts). O produto continua aparecendo quando o termo casa com
// outra coisa (nome, categoria, descricao, codigo).
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const sandalia = (
  variants: { value: string; active: boolean; stockIncrement?: number }[],
) => ({
  name: "Sandalia Rasteira",
  category: "Calcados",
  description: null,
  variants,
});

describe("busca por variacao esgotada", () => {
  it("o 38 zerado nao acha o produto pelo 38", () => {
    expect(
      produtoCombinaComBusca(
        sandalia([
          { value: "37", active: true, stockIncrement: 2 },
          { value: "38", active: true, stockIncrement: 0 },
        ]),
        "38",
      ),
    ).toBe(false);
  });

  it("estoque negativo ou ausente conta como esgotado", () => {
    expect(
      produtoCombinaComBusca(
        sandalia([{ value: "38", active: true, stockIncrement: -1 }]),
        "38",
      ),
    ).toBe(false);
    expect(
      produtoCombinaComBusca(sandalia([{ value: "38", active: true }]), "38"),
    ).toBe(false);
  });

  it("CONTROLE: o 38 com estoque acha", () => {
    expect(
      produtoCombinaComBusca(
        sandalia([
          { value: "37", active: true, stockIncrement: 0 },
          { value: "38", active: true, stockIncrement: 1 },
        ]),
        "38",
      ),
    ).toBe(true);
  });

  it("o 38 com estoque mas desligado continua sem achar", () => {
    expect(
      produtoCombinaComBusca(
        sandalia([{ value: "38", active: false, stockIncrement: 5 }]),
        "38",
      ),
    ).toBe(false);
  });

  it("o codigo (sku) da variacao esgotada tambem nao acha", () => {
    expect(
      produtoCombinaComBusca(
        {
          ...sandalia([]),
          variants: [
            { value: "38", active: true, stockIncrement: 0, sku: "SR-38" },
          ],
        },
        "SR-38",
      ),
    ).toBe(false);
  });

  it("o produto continua aparecendo quando o termo casa com o nome", () => {
    expect(
      produtoCombinaComBusca(
        sandalia([{ value: "38", active: true, stockIncrement: 0 }]),
        "rasteira",
      ),
    ).toBe(true);
    // nome + tamanho esgotado: o "38" nao casa com nada, entao nao entra
    expect(
      produtoCombinaComBusca(
        sandalia([{ value: "38", active: true, stockIncrement: 0 }]),
        "rasteira 38",
      ),
    ).toBe(false);
  });
});
