// Regras puras do aviso "Pix vencido" da ficha e do cartão do pedido no painel
// (`src/components/admin/orders/aviso-de-pix-vencido.ts`): quem aguarda Pix do
// app, quando o aviso aparece e qual das duas frases a lojista lê. Os testes
// das telas só olham a frase pronta; aqui cada condição é provada sozinha.
import { describe, expect, it } from "vitest";

import {
  AVISO_DE_RESERVA_AO_AVANCAR_PIX,
  aguardaPixOnline,
  avisoDePixVencido,
} from "@/components/admin/orders/aviso-de-pix-vencido";
import type { Order } from "@/types";

const PRAZO = "2026-11-24T12:00:00.000Z";
const NO_PRAZO = Date.parse(PRAZO);

function pedido(campos: Partial<Order> = {}): Order {
  return {
    id: "ped-1",
    status: "processing",
    paymentStatus: "aguardando",
    paymentMethod: "online",
    metodoOnline: "pix",
    expiraEm: PRAZO,
    retiradaNaLoja: false,
    cancelledAfterShipping: false,
    canal: "app",
    ...campos,
  } as unknown as Order;
}

const ABERTURA =
  "O Pix deste pedido venceu pelo horário previsto, mas o pagamento ainda não consta.";

describe("aguardaPixOnline", () => {
  it("pedido do app, aguardando, online e por Pix: aguarda", () => {
    expect(aguardaPixOnline(pedido())).toBe(true);
  });

  it("retirada na loja fica de fora (mantém o comportamento anterior da confirmação)", () => {
    expect(aguardaPixOnline(pedido({ retiradaNaLoja: true }))).toBe(false);
  });

  it("venda de balcão (canal presencial) nunca aguarda Pix do app", () => {
    expect(aguardaPixOnline(pedido({ canal: "presencial" }))).toBe(false);
  });

  it("pagamento já confirmado, ou de outro estado, não aguarda", () => {
    expect(aguardaPixOnline(pedido({ paymentStatus: "pago" }))).toBe(false);
    expect(aguardaPixOnline(pedido({ paymentStatus: "estornado" }))).toBe(
      false,
    );
  });

  it("pagamento na entrega/loja (não online) não aguarda", () => {
    expect(aguardaPixOnline(pedido({ paymentMethod: "loja" as never }))).toBe(
      false,
    );
  });

  it("online por cartão ou sem método online não aguarda Pix", () => {
    expect(aguardaPixOnline(pedido({ metodoOnline: "credito" }))).toBe(false);
    expect(aguardaPixOnline(pedido({ metodoOnline: "debito" }))).toBe(false);
    expect(aguardaPixOnline(pedido({ metodoOnline: null }))).toBe(false);
    expect(aguardaPixOnline(pedido({ metodoOnline: undefined }))).toBe(false);
  });

  it("entrega local e envio por transportadora seguem aguardando Pix", () => {
    expect(
      aguardaPixOnline(pedido({ shippingOptionId: "local-delivery" })),
    ).toBe(true);
    expect(aguardaPixOnline(pedido({ shippingOptionId: "pac" }))).toBe(true);
  });
});

describe("avisoDePixVencido", () => {
  it("no instante exato do prazo o aviso já aparece; um milissegundo antes, não", () => {
    expect(avisoDePixVencido(pedido(), NO_PRAZO)).not.toBeNull();
    expect(avisoDePixVencido(pedido(), NO_PRAZO - 1)).toBeNull();
    expect(avisoDePixVencido(pedido(), NO_PRAZO + 1)).not.toBeNull();
  });

  it("só pedidos em separação ou em envio recebem o aviso", () => {
    expect(
      avisoDePixVencido(pedido({ status: "processing" }), NO_PRAZO),
    ).not.toBeNull();
    expect(
      avisoDePixVencido(pedido({ status: "shipping" }), NO_PRAZO),
    ).not.toBeNull();
    for (const status of ["pending", "delivered", "cancelled"]) {
      expect(
        avisoDePixVencido(pedido({ status: status as never }), NO_PRAZO),
      ).toBeNull();
    }
  });

  it("sem prazo, ou com prazo ilegível, não há aviso (nunca inventa horário)", () => {
    expect(
      avisoDePixVencido(pedido({ expiraEm: undefined }), NO_PRAZO + 1e9),
    ).toBeNull();
    expect(
      avisoDePixVencido(pedido({ expiraEm: "" }), NO_PRAZO + 1e9),
    ).toBeNull();
    expect(
      avisoDePixVencido(pedido({ expiraEm: "amanhã" }), NO_PRAZO + 1e9),
    ).toBeNull();
  });

  it("não é Pix do app (pago, cartão, balcão): sem aviso mesmo com o prazo vencido", () => {
    const depois = NO_PRAZO + 60_000;
    expect(
      avisoDePixVencido(pedido({ paymentStatus: "pago" }), depois),
    ).toBeNull();
    expect(
      avisoDePixVencido(pedido({ metodoOnline: "credito" }), depois),
    ).toBeNull();
    expect(
      avisoDePixVencido(pedido({ paymentMethod: "loja" as never }), depois),
    ).toBeNull();
    expect(
      avisoDePixVencido(pedido({ canal: "presencial" }), depois),
    ).toBeNull();
  });

  it("envio ou entrega: frase 'Se não recebeu por fora... Cancelar pedido'", () => {
    expect(avisoDePixVencido(pedido(), NO_PRAZO)).toBe(
      `${ABERTURA} Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.`,
    );
  });

  it("retirada ainda na loja: frase que fala em liberar o estoque", () => {
    expect(avisoDePixVencido(pedido({ retiradaNaLoja: true }), NO_PRAZO)).toBe(
      `${ABERTURA} Confira com o cliente. Se você não recebeu por fora e a peça continua na loja, use Cancelar pedido para liberar o estoque.`,
    );
  });

  it("retirada cancelada depois de despachada: volta à frase de envio (a peça não está na loja)", () => {
    expect(
      avisoDePixVencido(
        pedido({ retiradaNaLoja: true, cancelledAfterShipping: true }),
        NO_PRAZO,
      ),
    ).toBe(
      `${ABERTURA} Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.`,
    );
  });

  it("o prazo com 6 dígitos de fração do Postgres vale pelo instante certo", () => {
    const comMicros = pedido({ expiraEm: "2026-11-24T12:00:00.123456Z" });
    const instante = Date.parse("2026-11-24T12:00:00.123Z");
    expect(avisoDePixVencido(comMicros, instante - 1)).toBeNull();
    expect(avisoDePixVencido(comMicros, instante)).not.toBeNull();
  });
});

describe("AVISO_DE_RESERVA_AO_AVANCAR_PIX", () => {
  it("avisa que avançar não confirma o Pix", () => {
    expect(AVISO_DE_RESERVA_AO_AVANCAR_PIX).toBe(
      "Avançar não confirma o Pix. Se você não recebeu por fora, confira com o cliente antes de seguir.",
    );
  });
});
