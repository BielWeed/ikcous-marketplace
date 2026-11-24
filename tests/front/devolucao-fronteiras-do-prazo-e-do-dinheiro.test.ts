// Fronteiras das regras PURAS da devolução (src/lib/devolucao.ts) que a
// mutação achou sem teste: o segundo exato em que o prazo vira vencido, a conta
// da seleção em centavos (ponto flutuante), a escolha de itens com quantidade
// zero, o que volta ao estoque por padrão e o desconto do "Não veio" em
// centavos que não fecham (3 itens de R$ 33,33).
import { describe, expect, it } from "vitest";

import {
  centavosDosItensQueNaoVieram,
  erroDosItens,
  pedidoDentroDoPrazo,
  reestocarPorPadrao,
  valorDaSelecao,
} from "@/lib/devolucao";
import type { ItemElegivel } from "@/types/devolucao";

const itemDe = (
  id: string,
  quantidade: number,
  valor_unitario: number,
): ItemElegivel => ({
  order_item_id: id,
  product_id: `p-${id}`,
  product_name: id,
  image_url: null,
  quantidade,
  ja_devolvida: 0,
  disponivel: quantidade,
  valor_unitario,
});

describe("prazo do pedido de devolução: o segundo exato da virada do dia (Brasília)", () => {
  // O prazo é um DIA (`YYYY-MM-DD`): vale até 23:59:59 de Brasília (UTC-3, sem
  // horário de verão desde 2019). 02:59:59Z ainda é o dia anterior em Brasília;
  // 03:00:00Z já é a meia-noite do dia seguinte.
  it.each([
    ["2026-10-02T02:59:59Z", true],
    ["2026-10-02T03:00:00Z", false],
    ["2026-10-01T03:00:00Z", true],
    ["2026-10-01T02:59:59Z", true],
    ["2026-09-30T03:00:00Z", true],
  ])(
    "pedido às %s com prazo até 2026-10-01 → dentro: %s",
    (criadaEm, dentro) => {
      expect(pedidoDentroDoPrazo(criadaEm, "2026-10-01")).toBe(dentro);
    },
  );
});

describe("valorDaSelecao: centavos inteiros, nunca ponto flutuante", () => {
  // Contados à mão: 3 × 0,10 = 0,30; 8,20 + 0,30 = 8,50; 9 × 0,07 = 0,63. Em
  // ponto flutuante dão 0,30000000000000004; 8,499999999999998; 0,6300000000000001.
  it.each([
    [[itemDe("a", 3, 0.1)], new Map([["a", 3]]), 0.3],
    [
      [itemDe("a", 1, 8.2), itemDe("b", 1, 0.3)],
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
      8.5,
    ],
    [[itemDe("a", 9, 0.07)], new Map([["a", 9]]), 0.63],
  ])("soma exata em centavos (%#)", (itens, selecao, esperado) => {
    expect(valorDaSelecao(itens, selecao)).toBe(esperado);
  });
});

describe("erroDosItens: quantidade zero não conta como item escolhido", () => {
  it("mapa só com zeros pede para escolher; uma unidade escolhida libera", () => {
    const mensagem = "Escolha ao menos um item para devolver.";
    expect(erroDosItens(new Map([["a", 0]]))).toBe(mensagem);
    expect(
      erroDosItens(
        new Map([
          ["a", 0],
          ["b", 0],
        ]),
      ),
    ).toBe(mensagem);
    expect(
      erroDosItens(
        new Map([
          ["a", 0],
          ["b", 1],
        ]),
      ),
    ).toBeNull();
  });
});

describe("reestocarPorPadrao: só o que voltou novo volta à prateleira sozinho", () => {
  it("usada, danificada e 'não veio' não reestocam por padrão", () => {
    expect(reestocarPorPadrao("nova")).toBe(true);
    expect(reestocarPorPadrao("usada")).toBe(false);
    expect(reestocarPorPadrao("danificada")).toBe(false);
    expect(reestocarPorPadrao("ausente")).toBe(false);
  });
});

describe("centavosDosItensQueNaoVieram com 3 itens de R$ 33,33", () => {
  const linha = { quantidade: 1, valor_unitario: 33.33 };
  const tres = [linha, { ...linha }, { ...linha }];
  const [primeira, segunda, terceira] = tres;

  // Contas à mão. Sem cupom o servidor guarda 99,99 (3 × 33,33): cada item é
  // 33,33. Com cupom de R$ 0,99 o servidor guarda 99,00: cada item é 33,00. Com
  // cupom de R$ 0,01 o servidor guarda 99,98, que não divide em três partes
  // iguais: 1 item = 33,33 (33,3267 arredondado), 2 itens = 66,65 (66,6533).
  it.each([
    [9999, 3333, 6666],
    [9900, 3300, 6600],
    [9998, 3333, 6665],
  ])(
    "valor do servidor %i: 1 item não veio = %i; 2 itens = %i; os 3 = tudo",
    (servidor, umItem, doisItens) => {
      expect(centavosDosItensQueNaoVieram(servidor, tres, [primeira])).toBe(
        umItem,
      );
      expect(
        centavosDosItensQueNaoVieram(servidor, tres, [primeira, segunda]),
      ).toBe(doisItens);
      expect(centavosDosItensQueNaoVieram(servidor, tres, tres)).toBe(servidor);
      // Partes complementares (2 itens + o terceiro) fecham o valor do
      // servidor, sem sobrar nem faltar centavo.
      expect(
        doisItens + centavosDosItensQueNaoVieram(servidor, tres, [terceira]),
      ).toBe(servidor);
    },
  );
});
