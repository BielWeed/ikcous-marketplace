// FORMA DE PAGAMENTO — duas bordas que `forma-de-pagamento*.test.ts` deixava
// passar (achadas por mutação em `src/lib/forma-de-pagamento.ts`):
//
//  1. `avisoDeJurosDoParcelamento(null)`: a tela de pagamento confirmado chama
//     com `parcelas: null` quando o pedido foi pago no crédito mas o banco não
//     gravou o número de parcelas. O aviso tem de dizer só "Juros do
//     parcelamento, se houver, vêm na fatura." — nunca "Parcelado em nullx".
//  2. `pedidoSemValorAPagar` com FRETE: o teste só conferia compras sem frete.
//     A conta é subtotal − desconto + frete; com o sinal do frete errado, um
//     pedido que de fato fechou em R$ 0,00 deixaria de ser "Sem valor a pagar"
//     e um pedido com valor a pagar poderia virar "sem valor". E o arredondamento
//     em centavos tem de ser o do banco (`round`), não o de cortar: R$ 1,15 em
//     ponto flutuante é 114,99999… centavos.
import { describe, expect, it } from "vitest";

import {
  avisoDeJurosDoParcelamento,
  pedidoSemValorAPagar,
} from "@/lib/forma-de-pagamento";

describe("avisoDeJurosDoParcelamento", () => {
  const SO_O_AVISO = "Juros do parcelamento, se houver, vêm na fatura.";

  it("sem número de parcelas (nulo ou ausente) diz só o aviso — sem 'null' nem 'undefined' no texto", () => {
    expect(avisoDeJurosDoParcelamento(null)).toBe(SO_O_AVISO);
    expect(avisoDeJurosDoParcelamento(undefined)).toBe(SO_O_AVISO);
  });

  it("com parcelas diz quantas, e depois o aviso", () => {
    expect(avisoDeJurosDoParcelamento(3)).toBe(
      `Parcelado em 3x no cartão. ${SO_O_AVISO}`,
    );
    expect(avisoDeJurosDoParcelamento(12)).toBe(
      `Parcelado em 12x no cartão. ${SO_O_AVISO}`,
    );
  });
});

describe("pedidoSemValorAPagar — a conta com frete", () => {
  it("subtotal 50, desconto 60 e frete 10 fecham em zero: sem valor a pagar", () => {
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: 50,
        discount: 60,
        shipping: 10,
      }),
    ).toBe(true);
  });

  it("o sinal do frete conta: subtotal 50, desconto 60 e frete -10 NÃO fecham em zero", () => {
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: 50,
        discount: 60,
        shipping: -10,
      }),
    ).toBe(false);
  });

  it("com total zero mas frete sobrando, a conta não bate: NÃO é sem valor a pagar", () => {
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: 100,
        discount: 100,
        shipping: 15,
      }),
    ).toBe(false);
  });

  it("ruído de ponto flutuante nas três parcelas da conta arredonda em centavos (round, não floor)", () => {
    // 1,15 → 114,999… e 1,29 → 129,000…03: cortar daria 114 − 129 + 14 = −1.
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: 1.15,
        discount: 1.29,
        shipping: 0.14,
      }),
    ).toBe(true);
  });

  it("parcela da conta que não é número (NaN) conta como ausente: vale o total", () => {
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: Number.NaN,
        discount: 0,
        shipping: 0,
      }),
    ).toBe(true);
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: 10,
        discount: Number.NaN,
        shipping: 0,
      }),
    ).toBe(true);
  });

  it("parcela da conta como texto (valor sujo do banco) conta como ausente, não como zero", () => {
    expect(
      pedidoSemValorAPagar({
        total: 0,
        subtotal: "100" as unknown as number,
        discount: 0,
        shipping: 0,
      }),
    ).toBe(true);
  });
});
