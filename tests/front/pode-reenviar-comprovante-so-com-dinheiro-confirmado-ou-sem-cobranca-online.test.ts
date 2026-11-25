// "Reenviar comprovante" gasta o ÚNICO e-mail do pedido. Por isso o botão só
// existe quando o comprovante é verdadeiro: online com dinheiro confirmado
// (`pago`) ou pedido sem cobrança online (pagar na entrega/retirada). Qualquer
// outra situação de cobrança — aguardando, recusado, expirado, estornado, pago
// depois de expirar — NÃO oferece o botão, em nenhuma forma de pagamento.
import { describe, expect, it } from "vitest";

import { podeReenviarComprovante } from "@/lib/pode-reenviar-comprovante";
import type { Order, PaymentMethod, PaymentStatus } from "@/types";

type Pedido = Pick<Order, "paymentMethod" | "paymentStatus" | "status">;

const FORMAS: readonly PaymentMethod[] = ["pix", "card", "cash", "online"];

const SEM_COMPROVANTE: readonly PaymentStatus[] = [
  "aguardando",
  "recusado",
  "expirado",
  "estornado",
  "pago_apos_expirar",
];

function pedido(
  forma: PaymentMethod,
  pagamento: PaymentStatus | null | undefined,
): Pedido {
  const base: Pedido = {
    paymentMethod: forma,
    status: "pending",
  };
  return pagamento === undefined ? base : { ...base, paymentStatus: pagamento };
}

describe("podeReenviarComprovante: só com comprovante verdadeiro", () => {
  describe.each(SEM_COMPROVANTE)("cobrança %s", (situacao) => {
    it.each(FORMAS)("forma %s: o botão some", (forma) => {
      expect(podeReenviarComprovante(pedido(forma, situacao))).toBe(false);
    });
  });

  it.each(FORMAS)("cobrança paga, forma %s: o botão aparece", (forma) => {
    expect(podeReenviarComprovante(pedido(forma, "pago"))).toBe(true);
  });

  it.each(["pix", "card", "cash"] as const)(
    "pagar na entrega/retirada (%s) sem situação de cobrança: o botão aparece",
    (forma) => {
      expect(podeReenviarComprovante(pedido(forma, null))).toBe(true);
      expect(podeReenviarComprovante(pedido(forma, undefined))).toBe(true);
      expect(
        podeReenviarComprovante(pedido(forma, "recebido_na_entrega")),
      ).toBe(true);
    },
  );

  it("online sem situação de cobrança ou 'recebido na entrega' não tem comprovante", () => {
    expect(podeReenviarComprovante(pedido("online", null))).toBe(false);
    expect(podeReenviarComprovante(pedido("online", undefined))).toBe(false);
    expect(
      podeReenviarComprovante(pedido("online", "recebido_na_entrega")),
    ).toBe(false);
  });
});
