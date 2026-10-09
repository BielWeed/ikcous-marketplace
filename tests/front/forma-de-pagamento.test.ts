// Fonte ÚNICA do rótulo da forma de pagamento de um pedido (defeito D4 da
// investigação do balcão, 28/09/2026). Antes cada tela dizia uma coisa: a
// planilha chamava `card` de "Crédito Seguro" e `online` de "Outro"; a ficha
// chamava `card` de "Cartão de crédito". Só texto de exibição — o valor
// gravado no banco (`payment_method`) não muda.
import { rotuloDaFormaDoPedido } from "@/lib/forma-de-pagamento";
import { describe, expect, it } from "vitest";

describe("rotuloDaFormaDoPedido", () => {
  it.each([
    // pedido do SITE (checkout): pix/cartão/dinheiro são "na entrega".
    ["cash", "online", undefined, "Dinheiro"],
    ["pix", "online", undefined, "PIX Instantâneo"],
    ["card", "online", undefined, "Cartão na entrega"],
    // venda de BALCÃO: o cartão é o da maquininha, não "na entrega".
    ["cash", "presencial", undefined, "Dinheiro"],
    ["pix", "presencial", undefined, "PIX Instantâneo"],
    ["card", "presencial", undefined, "Cartão na maquininha"],
    // pago pelo app (Mercado Pago): a forma vem de `metodo_online`.
    ["online", "online", "pix", "PIX pelo site"],
    ["online", "online", "credito", "Cartão de crédito pelo site"],
    ["online", "online", "debito", "Cartão de débito pelo site"],
  ] as const)(
    "%s no canal %s (metodoOnline %s) -> %s",
    (paymentMethod, canal, metodoOnline, esperado) => {
      expect(
        rotuloDaFormaDoPedido({ paymentMethod, canal, metodoOnline }),
      ).toBe(esperado);
    },
  );

  it("online sem saber qual foi (campo ausente, nulo ou fora do conjunto) NÃO inventa PIX nem vira 'Outro'", () => {
    // A tela de pedidos ainda não carrega `metodo_online`; chutar "PIX" aqui
    // mentiria no dia em que a loja ligar o cartão. "Pagamento pelo site" é
    // verdade em qualquer caso.
    for (const metodoOnline of [undefined, null, "", "boleto"]) {
      expect(
        rotuloDaFormaDoPedido({ paymentMethod: "online", metodoOnline }),
      ).toBe("Pagamento pelo site");
    }
  });

  it("canal ausente, nulo ou desconhecido é SITE (ramifica por 'presencial', nunca por 'online')", () => {
    for (const canal of [undefined, null, "", "online", "balcao"]) {
      expect(rotuloDaFormaDoPedido({ paymentMethod: "card", canal })).toBe(
        "Cartão na entrega",
      );
    }
  });

  it("o `metodoOnline` só vale para `online`: venda no balcão não vira cartão pelo site", () => {
    expect(
      rotuloDaFormaDoPedido({
        paymentMethod: "card",
        canal: "presencial",
        metodoOnline: "credito",
      }),
    ).toBe("Cartão na maquininha");
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "cash", metodoOnline: "pix" }),
    ).toBe("Dinheiro");
  });

  it("forma desconhecida ou ausente diz 'Outro' (nunca o rótulo de outra forma, nunca vazio)", () => {
    for (const paymentMethod of [
      undefined,
      null,
      "",
      "boleto",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(rotuloDaFormaDoPedido({ paymentMethod })).toBe("Outro");
    }
  });

  it("os dois rótulos errados do relatório sumiram de todas as combinações", () => {
    const metodos = ["cash", "pix", "card", "online", "x", null, undefined];
    const canais = ["online", "presencial", null, undefined];
    const onlines = ["pix", "credito", "debito", "x", null, undefined];
    for (const paymentMethod of metodos)
      for (const canal of canais)
        for (const metodoOnline of onlines) {
          const rotulo = rotuloDaFormaDoPedido({
            paymentMethod,
            canal,
            metodoOnline,
          });
          expect(rotulo).not.toBe("Crédito Seguro");
          expect(rotulo).not.toBe("Cartão de crédito");
          if (canal === "presencial" && paymentMethod === "card") {
            expect(rotulo.toLowerCase()).not.toContain("entrega");
          }
        }
  });
});
