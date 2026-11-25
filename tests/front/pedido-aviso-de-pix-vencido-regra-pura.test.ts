// A regra de "Pix vencido" do painel (`avisoDePixVencido`) e de "aguarda Pix
// pelo app" (`aguardaPixOnline`) só era exercida de ponta a ponta, pelos
// cartões e pela ficha do pedido. Aqui ela é testada sem tela: cada condição
// que liga o aviso (situação do pedido, cobrança, forma, canal, prazo) é
// derrubada sozinha, e a fronteira do prazo é medida no milissegundo.
import {
  AVISO_DE_RESERVA_AO_AVANCAR_PIX,
  aguardaPixOnline,
  avisoDePixVencido,
} from "@/components/admin/orders/aviso-de-pix-vencido";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const VENCE_EM = "2026-11-20T12:00:00.000Z";
const NO_VENCIMENTO = Date.parse(VENCE_EM);

function pedido(parcial: Record<string, unknown> = {}): Order {
  return {
    id: "pedido-fixture",
    status: "processing",
    paymentStatus: "aguardando",
    paymentMethod: "online",
    metodoOnline: "pix",
    expiraEm: VENCE_EM,
    canal: "app",
    retiradaNaLoja: false,
    shippingOptionId: "correios-pac",
    cancelledAfterShipping: false,
    ...parcial,
  } as unknown as Order;
}

const AVISO_BASE =
  "O Pix deste pedido venceu pelo horário previsto, mas o pagamento ainda não consta.";
const TEXTO_DE_ENVIO = `${AVISO_BASE} Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.`;
const TEXTO_DE_RETIRADA = `${AVISO_BASE} Confira com o cliente. Se você não recebeu por fora e a peça continua na loja, use Cancelar pedido para liberar o estoque.`;

describe("avisoDePixVencido — quando liga e quando fica calado", () => {
  it("liga exatamente no instante do vencimento e não um milissegundo antes", () => {
    expect(avisoDePixVencido(pedido(), NO_VENCIMENTO - 1)).toBeNull();
    expect(avisoDePixVencido(pedido(), NO_VENCIMENTO)).toBe(TEXTO_DE_ENVIO);
    expect(avisoDePixVencido(pedido(), NO_VENCIMENTO + 1)).toBe(TEXTO_DE_ENVIO);
  });

  it("só avisa em 'processing' e 'shipping': nas demais situações fica calado", () => {
    for (const status of ["processing", "shipping"]) {
      expect(avisoDePixVencido(pedido({ status }), NO_VENCIMENTO), status).toBe(
        TEXTO_DE_ENVIO,
      );
    }
    for (const status of [
      "pending",
      "delivered",
      "cancelled",
      "returned",
      undefined,
    ]) {
      expect(
        avisoDePixVencido(pedido({ status }), NO_VENCIMENTO),
        String(status),
      ).toBeNull();
    }
  });

  it("cada condição da cobrança, sozinha, apaga o aviso", () => {
    const apagam: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["já pago", { paymentStatus: "pago" }],
      ["recusado", { paymentStatus: "recusado" }],
      ["cobrança ausente", { paymentStatus: null }],
      ["pagamento na entrega", { paymentMethod: "entrega" }],
      ["cartão online", { metodoOnline: "cartao" }],
      ["forma online ausente", { metodoOnline: undefined }],
      ["venda de balcão (canal presencial)", { canal: "presencial" }],
    ];
    for (const [nome, parcial] of apagam) {
      expect(
        avisoDePixVencido(pedido(parcial), NO_VENCIMENTO),
        nome,
      ).toBeNull();
    }
  });

  it("sem prazo legível não há aviso, mesmo com o pedido todo no jeito", () => {
    for (const expiraEm of [undefined, null, "", "data ilegível"]) {
      expect(
        avisoDePixVencido(pedido({ expiraEm }), NO_VENCIMENTO + 86_400_000),
        String(expiraEm),
      ).toBeNull();
    }
  });

  it("retirada na loja usa o texto que fala em liberar o estoque", () => {
    expect(
      avisoDePixVencido(pedido({ retiradaNaLoja: true }), NO_VENCIMENTO),
    ).toBe(TEXTO_DE_RETIRADA);
  });

  it("retirada que já saiu e foi cancelada depois NÃO promete reposição: volta ao texto comum", () => {
    expect(
      avisoDePixVencido(
        pedido({ retiradaNaLoja: true, cancelledAfterShipping: true }),
        NO_VENCIMENTO,
      ),
    ).toBe(TEXTO_DE_ENVIO);
  });

  it("envio com 'cancelledAfterShipping' marcado continua com o texto comum", () => {
    expect(
      avisoDePixVencido(
        pedido({ retiradaNaLoja: false, cancelledAfterShipping: true }),
        NO_VENCIMENTO,
      ),
    ).toBe(TEXTO_DE_ENVIO);
  });

  it("o prazo vem com fração de segundo e fuso: vence no instante certo", () => {
    const p = pedido({ expiraEm: "2026-11-19T12:00:00.123456-03:00" });
    const instante = Date.parse("2026-11-19T15:00:00.123Z");
    expect(avisoDePixVencido(p, instante - 1)).toBeNull();
    expect(avisoDePixVencido(p, instante)).toBe(TEXTO_DE_ENVIO);
  });
});

describe("aguardaPixOnline — o Pix pelo app que ainda não foi pago", () => {
  it("pedido de envio com Pix aguardando: sim", () => {
    expect(aguardaPixOnline(pedido())).toBe(true);
  });

  it("retirada na loja: não (a confirmação de avanço dela é a de antes)", () => {
    expect(aguardaPixOnline(pedido({ retiradaNaLoja: true }))).toBe(false);
  });

  it("balcão (canal presencial): não, mesmo marcado como Pix aguardando", () => {
    expect(aguardaPixOnline(pedido({ canal: "presencial" }))).toBe(false);
  });

  it("cada condição da cobrança, sozinha, vira 'não'", () => {
    for (const parcial of [
      { paymentStatus: "pago" },
      { paymentStatus: null },
      { paymentMethod: "entrega" },
      { metodoOnline: "cartao" },
    ]) {
      expect(aguardaPixOnline(pedido(parcial)), JSON.stringify(parcial)).toBe(
        false,
      );
    }
  });

  it("não depende da situação nem do prazo: pedido pendente e prazo futuro continuam 'aguardando'", () => {
    expect(
      aguardaPixOnline(
        pedido({ status: "pending", expiraEm: "2099-01-01T00:00:00Z" }),
      ),
    ).toBe(true);
  });
});

describe("AVISO_DE_RESERVA_AO_AVANCAR_PIX", () => {
  it("diz que avançar não confirma o Pix", () => {
    expect(AVISO_DE_RESERVA_AO_AVANCAR_PIX).toBe(
      "Avançar não confirma o Pix. Se você não recebeu por fora, confira com o cliente antes de seguir.",
    );
  });
});
