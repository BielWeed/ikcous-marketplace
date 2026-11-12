import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";

const chave = chaveDoItemDoCupom("prod-caneca", null);

function estadoComItem(quantidade: number, estoque: number): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "venda-estoque-que-caiu"),
    itens: [
      {
        chave,
        productId: "prod-caneca",
        variantId: null,
        nome: "Caneca",
        variacao: null,
        preco: 20,
        quantidade,
        estoque,
        imagem: "",
      },
    ],
  };
}

function alterarQuantidade(estado: EstadoDaVenda, delta: -1 | 1) {
  return reducerDaVenda(estado, { tipo: "quantidade_alterada", chave, delta });
}

describe("quantidade do cupom quando o estoque cai", () => {
  // Sem limitar o teto apenas ao aumento, o primeiro menos deixa 5 no cupom.
  it("reduz de 5 para 4, 3 e 2 com estoque atualizado para 2 e limpa o aviso", () => {
    let estado = estadoComItem(5, 2);
    estado = alterarQuantidade(estado, 1);
    expect(estado.aviso?.tipo).toBe("esgotado");

    for (const quantidade of [4, 3, 2]) {
      estado = alterarQuantidade(estado, -1);
      expect(estado.itens[0].quantidade).toBe(quantidade);
      expect(estado.itens[0].estoque).toBe(2);
      expect(estado.aviso).toBeNull();
    }
  });

  it("continua recusando aumentar de 2 para 3 com estoque 2", () => {
    const estado = alterarQuantidade(estadoComItem(2, 2), 1);

    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Caneca",
      estoque: 2,
      naVenda: 2,
    });
  });

  it("menos em uma unidade remove o item e limpa o aviso", () => {
    const comAviso = alterarQuantidade(estadoComItem(1, 0), 1);
    expect(comAviso.aviso?.tipo).toBe("esgotado");

    const estado = alterarQuantidade(comAviso, -1);

    expect(estado.itens).toEqual([]);
    expect(estado.aviso).toBeNull();
  });

  it("continua permitindo aumentar abaixo do teto", () => {
    const estado = alterarQuantidade(estadoComItem(1, 2), 1);

    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.aviso).toBeNull();
  });
});
