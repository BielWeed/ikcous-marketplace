// ELEGIBILIDADE DA ETIQUETA — bordas que `elegibilidade-da-etiqueta.test.ts`
// não cruza:
//  1. `freteEfetivoDoPedido`: frete cobrado ABAIXO de R$ 1,00 e frete sem nenhum
//     valor legível (a tela diria "frete grátis", e não "frete de R$ 1");
//  2. `situacaoDaCompraPeloHistorico`: evento cuja data não se lê vale como o
//     mais ANTIGO (epoch 0) e nunca atropela um evento datado.
import { describe, expect, it } from "vitest";

import {
  freteEfetivoDoPedido,
  situacaoDaCompraPeloHistorico,
} from "@/lib/elegibilidade-da-etiqueta";

describe("freteEfetivoDoPedido — valores pequenos e ilegíveis", () => {
  it("frete de R$ 0,50 na coluna nova vale: não cai no shipping_cost", () => {
    expect(freteEfetivoDoPedido({ shipping: 0.5, shipping_cost: 0 })).toBe(0.5);
    expect(freteEfetivoDoPedido({ shipping: 0.5, shipping_cost: 9 })).toBe(0.5);
  });

  it("frete de exatamente R$ 1,00 na coluna nova vale (e vem como texto do banco também)", () => {
    expect(freteEfetivoDoPedido({ shipping: 1, shipping_cost: 9 })).toBe(1);
    expect(freteEfetivoDoPedido({ shipping: "1.00", shipping_cost: 9 })).toBe(
      1,
    );
  });

  it("nenhuma das duas colunas legível: frete ZERO, nunca um valor inventado", () => {
    expect(
      freteEfetivoDoPedido({ shipping: 0, shipping_cost: undefined }),
    ).toBe(0);
    expect(freteEfetivoDoPedido({ shipping: null, shipping_cost: "abc" })).toBe(
      0,
    );
    expect(freteEfetivoDoPedido({ shipping: "xx", shipping_cost: "yy" })).toBe(
      0,
    );
  });

  it("shipping negativo ou ilegível cai no shipping_cost do pedido antigo", () => {
    expect(freteEfetivoDoPedido({ shipping: -3, shipping_cost: 18.5 })).toBe(
      18.5,
    );
    expect(freteEfetivoDoPedido({ shipping: "abc", shipping_cost: 18.5 })).toBe(
      18.5,
    );
  });
});

describe("situacaoDaCompraPeloHistorico — data ilegível é tratada como a mais antiga", () => {
  const ID = "lbl-1";
  const gerada = {
    event_type: "etiqueta_gerada",
    created_at: "2026-10-27T10:00:00Z",
    payload: { label_id: ID },
  };
  const indeterminadoSemData = {
    event_type: "erro",
    created_at: "data-que-nao-existe",
    error_message: "Falha indeterminada no checkout/geração da etiqueta: x",
    payload: { etapa: "checkout_indeterminado", label_id: ID },
  };

  it("o evento sem data legível não vence o evento datado, qualquer que seja a ordem da lista", () => {
    expect(
      situacaoDaCompraPeloHistorico([gerada, indeterminadoSemData], ID),
    ).toBe("confirmada");
    expect(
      situacaoDaCompraPeloHistorico([indeterminadoSemData, gerada], ID),
    ).toBe("confirmada");
  });

  it("evento sem created_at nenhum também vale como o mais antigo", () => {
    const { created_at: _semData, ...semCampo } = indeterminadoSemData;
    expect(situacaoDaCompraPeloHistorico([gerada, semCampo], ID)).toBe(
      "confirmada",
    );
  });

  it("datas iguais: vale a ordem da lista (o último da lista fica por cima)", () => {
    const mesmoInstante = "2026-10-27T10:00:00Z";
    const geradaNoMesmoInstante = { ...gerada, created_at: mesmoInstante };
    const indeterminadoNoMesmoInstante = {
      ...indeterminadoSemData,
      created_at: mesmoInstante,
    };
    expect(
      situacaoDaCompraPeloHistorico(
        [geradaNoMesmoInstante, indeterminadoNoMesmoInstante],
        ID,
      ),
    ).toBe("indeterminada");
    expect(
      situacaoDaCompraPeloHistorico(
        [indeterminadoNoMesmoInstante, geradaNoMesmoInstante],
        ID,
      ),
    ).toBe("confirmada");
  });
});
