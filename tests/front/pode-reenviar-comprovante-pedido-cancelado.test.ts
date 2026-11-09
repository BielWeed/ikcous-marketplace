// Pedido CANCELADO não oferece "Reenviar comprovante" (achado da onda 50,
// 08/11/2026). A edge `send-order-confirmation` lê o pedido sem a coluna
// `status` e monta o e-mail com a abertura fixa "Recebemos seu pedido. Guarde
// este e-mail", com total e forma de pagamento e nenhuma palavra sobre o
// cancelamento; a reserva única do e-mail do pedido se gasta com esse texto,
// enquanto a tela do mesmo pedido diz "cancelado".
//
// A regra do botão mora na função pura; a tela só a chama. O teste de render
// (order-details-reenviar-comprovante-so-quando-faz-sentido.test.tsx) prende a
// costura com a ficha; este prende a função, inclusive os controles: o MESMO
// pedido, sem estar cancelado, continua oferecendo o botão.
import { describe, expect, it } from "vitest";

import { podeReenviarComprovante } from "@/lib/pode-reenviar-comprovante";
import type { Order, PaymentMethod, PaymentStatus } from "@/types";

type Pedido = Pick<Order, "paymentMethod" | "paymentStatus" | "status">;

const pedido = (
  forma: PaymentMethod,
  pagamento: PaymentStatus | null,
  status: Order["status"],
): Pedido => ({ paymentMethod: forma, paymentStatus: pagamento, status });

describe("podeReenviarComprovante — pedido cancelado", () => {
  it.each<[string, Pedido]>([
    [
      "pagar na entrega, sem status de pagamento",
      pedido("cash", null, "cancelled"),
    ],
    [
      "pagar na entrega, recebido pela loja",
      pedido("cash", "recebido_na_entrega", "cancelled"),
    ],
    ["online pago", pedido("online", "pago", "cancelled")],
  ])("%s: o botão some", (_descricao, p) => {
    expect(podeReenviarComprovante(p)).toBe(false);
  });

  it.each<[string, Pedido]>([
    [
      "pagar na entrega, sem status de pagamento",
      pedido("cash", null, "pending"),
    ],
    ["pagar na entrega, em separação", pedido("cash", null, "processing")],
    [
      "pagar na entrega, recebido pela loja, entregue",
      pedido("cash", "recebido_na_entrega", "delivered"),
    ],
    ["online pago, a caminho", pedido("online", "pago", "shipping")],
  ])("controle, %s e NÃO cancelado: o botão continua", (_descricao, p) => {
    expect(podeReenviarComprovante(p)).toBe(true);
  });

  it("borda: pedido sem status legível não é tratado como cancelado", () => {
    const semStatus = {
      paymentMethod: "cash",
      paymentStatus: null,
    } as unknown as Pedido;
    expect(podeReenviarComprovante(semStatus)).toBe(true);
  });
});
