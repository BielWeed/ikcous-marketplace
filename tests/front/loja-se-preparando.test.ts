import {
  formasNaEntregaOferecidas,
  liberacoesDaLinha,
  lojaAindaNaoRecebePedido,
  mensagemDoCarrinhoNoWhatsapp,
} from "@/lib/loja-se-preparando";
// A LOJA NOVA SÓ VENDE O QUE CONFIRMOU (28/11/2026, migration 20261655000000): a
// regra pura que a vitrine e o painel leem. A vitrine recebe dois booleanos da
// leitura pública (`entrega_local_liberada`, `pagamento_na_entrega_liberado`);
// o painel lê as datas da ficha (`entrega_confirmada_em`, `pagamento_confirmado_em`).
// Ausente (banco antes da migration) = liberado: o comportamento de antes.
import { describe, expect, it } from "vitest";

describe("liberacoesDaLinha", () => {
  it("a leitura pública traz os dois booleanos como estão", () => {
    expect(
      liberacoesDaLinha({
        entrega_local_liberada: false,
        pagamento_na_entrega_liberado: true,
      }),
    ).toEqual({
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: true,
    });
  });

  it("a ficha do painel traz as datas: NULL = pendente, data = liberado", () => {
    expect(
      liberacoesDaLinha({
        entrega_confirmada_em: null,
        pagamento_confirmado_em: "2026-11-28T10:00:00+00:00",
      }),
    ).toEqual({
      entregaLocalLiberada: false,
      pagamentoNaEntregaLiberado: true,
    });
  });

  it("o booleano da leitura pública vence a data (as duas nunca brigam, mas o público é o contrato da vitrine)", () => {
    expect(
      liberacoesDaLinha({
        entrega_local_liberada: true,
        entrega_confirmada_em: null,
      }),
    ).toEqual({ entregaLocalLiberada: true });
  });

  it("banco sem nada disso (antes da migration): nenhum campo — e a ausência lê como liberado", () => {
    expect(liberacoesDaLinha({ store_name: "Loja" })).toEqual({});
  });

  it("o cache offline já em camelCase passa adiante; lixo não vira booleano", () => {
    expect(
      liberacoesDaLinha({
        entregaLocalLiberada: false,
        pagamentoNaEntregaLiberado: "sim",
      }),
    ).toEqual({ entregaLocalLiberada: false });
  });
});

describe("formasNaEntregaOferecidas", () => {
  it("pagamento na entrega pendente: nenhuma forma na entrega (como a loja que só vende pelo app)", () => {
    expect(
      formasNaEntregaOferecidas({
        formasPagamentoEntrega: ["pix", "card", "cash"],
        pagamentoNaEntregaLiberado: false,
      }),
    ).toEqual([]);
  });

  it("liberado ou ausente: as formas da loja, normalizadas como sempre", () => {
    expect(
      formasNaEntregaOferecidas({
        formasPagamentoEntrega: ["cash", "pix"],
        pagamentoNaEntregaLiberado: true,
      }),
    ).toEqual(["cash", "pix"]);
    expect(
      formasNaEntregaOferecidas({ formasPagamentoEntrega: undefined }),
    ).toEqual(["pix", "card", "cash"]);
  });
});

describe("lojaAindaNaoRecebePedido", () => {
  const base = {
    pagamentoPeloApp: true,
    pagamentoNaEntregaLiberado: true,
    entregaLocalLiberada: true,
    retiradaLigada: false,
    soEntregaNaCidade: false,
  };

  it("loja confirmada: recebe", () => {
    expect(lojaAindaNaoRecebePedido(base)).toBe(false);
  });

  it("sem pagamento pelo app e com o pagamento na entrega pendente: não recebe", () => {
    expect(
      lojaAindaNaoRecebePedido({
        ...base,
        pagamentoPeloApp: false,
        pagamentoNaEntregaLiberado: false,
      }),
    ).toBe(true);
  });

  it("pagamento na entrega pendente mas com pagamento pelo app: recebe", () => {
    expect(
      lojaAindaNaoRecebePedido({ ...base, pagamentoNaEntregaLiberado: false }),
    ).toBe(false);
  });

  it("entrega pendente, sem retirada e sem transportadora possível (sem app ou só na cidade): não recebe", () => {
    expect(
      lojaAindaNaoRecebePedido({
        ...base,
        entregaLocalLiberada: false,
        pagamentoPeloApp: false,
      }),
    ).toBe(true);
    expect(
      lojaAindaNaoRecebePedido({
        ...base,
        entregaLocalLiberada: false,
        soEntregaNaCidade: true,
      }),
    ).toBe(true);
  });

  it("entrega pendente com retirada, ou com transportadora possível: recebe", () => {
    expect(
      lojaAindaNaoRecebePedido({
        ...base,
        entregaLocalLiberada: false,
        retiradaLigada: true,
        pagamentoPeloApp: false,
      }),
    ).toBe(false);
    expect(
      lojaAindaNaoRecebePedido({ ...base, entregaLocalLiberada: false }),
    ).toBe(false);
  });
});

describe("mensagemDoCarrinhoNoWhatsapp", () => {
  it("escreve os itens do carrinho, com a variação e a quantidade", () => {
    expect(
      mensagemDoCarrinhoNoWhatsapp([
        { nome: "Vestido Azul", variacao: "Tamanho: M", quantidade: 2 },
        { nome: "Brinco", quantidade: 1 },
      ]),
    ).toBe(
      "Olá! Quero fazer um pedido:\n- 2x Vestido Azul (Tamanho: M)\n- 1x Brinco",
    );
  });

  it("carrinho vazio: só a saudação", () => {
    expect(mensagemDoCarrinhoNoWhatsapp([])).toBe(
      "Olá! Quero fazer um pedido.",
    );
  });
});
