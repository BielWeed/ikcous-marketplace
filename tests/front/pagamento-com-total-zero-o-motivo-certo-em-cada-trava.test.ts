// Quando o total fecha em R$ 0,00 e o Finalizar trava, a cliente lê POR QUE
// travou (`textoDoPedidoSemValor` em `src/lib/pagamento-com-total-zero.ts`). O
// teste do módulo só conferia que a frase fala de "valor a pagar", então trocar
// o motivo de uma trava pelo da outra passava. Aqui cada motivo é preso ao seu
// texto: transportadora fala de pagamento antecipado, loja só no app fala da
// loja, e nenhum dos dois promete o que o outro diz.
import {
  formasDePagamentoParaTotalZero,
  saidaDoTotalZero,
  textoDoPedidoSemValor,
} from "@/lib/pagamento-com-total-zero";
import { describe, expect, it } from "vitest";

const base = {
  totalFinal: 0,
  freteFechado: true,
  paymentMethod: "online" as const,
};

describe("o motivo de cada trava do total zero", () => {
  it("envio por transportadora: o texto explica o pagamento antecipado", () => {
    const decisao = formasDePagamentoParaTotalZero({
      ...base,
      modalidadeDaLoja: false,
      formasNaEntrega: ["pix"],
    });
    expect(decisao.travaPor).toBe("transportadora");

    const texto = textoDoPedidoSemValor({ decisao, ehRetirada: false });
    expect(texto).toBe(
      "Este pedido não tem valor a pagar, mas o envio por transportadora só fecha com pagamento antecipado pelo app — e o app não cobra pedido sem valor.",
    );
    expect(texto).not.toContain("esta loja só recebe pelo app");
  });

  it("loja que só recebe pelo app: o texto fala da loja, não da transportadora", () => {
    const decisao = formasDePagamentoParaTotalZero({
      ...base,
      modalidadeDaLoja: true,
      formasNaEntrega: [],
    });
    expect(decisao.travaPor).toBe("loja-so-no-app");

    const texto = textoDoPedidoSemValor({ decisao, ehRetirada: true });
    expect(texto).toBe(
      "Este pedido não tem valor a pagar, mas esta loja só recebe pelo app — e o app não cobra pedido sem valor.",
    );
    expect(texto).not.toContain("transportadora");
  });

  it("sem trava, retirada e entrega têm frases diferentes e nenhuma menciona o app", () => {
    const decisao = formasDePagamentoParaTotalZero({
      ...base,
      modalidadeDaLoja: true,
      formasNaEntrega: ["cash"],
      paymentMethod: "cash",
    });
    expect(decisao.travaPor).toBeNull();

    expect(textoDoPedidoSemValor({ decisao, ehRetirada: true })).toBe(
      "Este pedido não tem valor a pagar. Você retira o pedido na loja e não paga nada.",
    );
    expect(textoDoPedidoSemValor({ decisao, ehRetirada: false })).toBe(
      "Este pedido não tem valor a pagar. Você recebe o pedido e não paga nada.",
    );
  });

  it("a saída de cada trava sem cupom e com cupom, palavra por palavra", () => {
    expect(
      saidaDoTotalZero({ travaPor: "transportadora", temCupom: true }),
    ).toBe(
      "Escolha retirada na loja ou entrega local (se a loja oferecer), tire o cupom, ou fale com a loja.",
    );
    expect(
      saidaDoTotalZero({ travaPor: "transportadora", temCupom: false }),
    ).toBe(
      "Escolha retirada na loja ou entrega local (se a loja oferecer), ou fale com a loja.",
    );
    expect(
      saidaDoTotalZero({ travaPor: "loja-so-no-app", temCupom: true }),
    ).toBe(
      "Tire o cupom para pagar pelo app, ou fale com a loja para combinar.",
    );
  });
});
