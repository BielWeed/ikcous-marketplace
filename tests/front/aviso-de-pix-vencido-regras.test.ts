// Aviso da ficha/cartão do pedido quando o Pix do app passou do prazo e o
// pagamento ainda não consta. A função decide SE avisa (só pedido em
// andamento, só Pix online ainda aguardando, só depois do prazo, nunca balcão)
// e QUAL texto (retirada com estoque preso fala em liberar o estoque). Sem
// teste próprio, cada condição abaixo podia ser invertida sem nada reprovar.
import {
  AVISO_DE_RESERVA_AO_AVANCAR_PIX,
  aguardaPixOnline,
  avisoDePixVencido,
} from "@/components/admin/orders/aviso-de-pix-vencido";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const PRAZO = "2026-11-10T12:00:00.000Z";
const PRAZO_MS = Date.parse(PRAZO);

const pixDoApp = (extra: Partial<Order> = {}): Order =>
  ({
    id: "pedido-1",
    status: "processing",
    paymentMethod: "online",
    metodoOnline: "pix",
    paymentStatus: "aguardando",
    expiraEm: PRAZO,
    cancelledAfterShipping: false,
    ...extra,
  }) as Order;

describe("avisoDePixVencido — quando avisa", () => {
  it("no instante exato do prazo já avisa; um milissegundo antes, não", () => {
    expect(avisoDePixVencido(pixDoApp(), PRAZO_MS)).toContain("venceu");
    expect(avisoDePixVencido(pixDoApp(), PRAZO_MS - 1)).toBeNull();
  });

  it("avisa em processing e em shipping, e só neles", () => {
    expect(
      avisoDePixVencido(pixDoApp({ status: "processing" }), PRAZO_MS),
    ).not.toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ status: "shipping" }), PRAZO_MS),
    ).not.toBeNull();
    for (const status of ["pending", "delivered", "cancelled"] as const) {
      expect(avisoDePixVencido(pixDoApp({ status }), PRAZO_MS)).toBeNull();
    }
  });

  it.each([
    "pago",
    "recusado",
    "expirado",
    "estornado",
    "pago_apos_expirar",
  ] as const)("pagamento %s não gera aviso de Pix vencido", (paymentStatus) => {
    expect(avisoDePixVencido(pixDoApp({ paymentStatus }), PRAZO_MS)).toBeNull();
  });

  it("paymentStatus ausente ou null não é 'aguardando'", () => {
    expect(
      avisoDePixVencido(pixDoApp({ paymentStatus: null }), PRAZO_MS),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ paymentStatus: undefined }), PRAZO_MS),
    ).toBeNull();
  });

  it("só Pix: cartão online e pagamento na entrega não avisam", () => {
    expect(
      avisoDePixVencido(pixDoApp({ metodoOnline: "credito" }), PRAZO_MS),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ metodoOnline: null }), PRAZO_MS),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ paymentMethod: "cash" }), PRAZO_MS),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ paymentMethod: "pix" }), PRAZO_MS),
    ).toBeNull();
  });

  it("venda de balcão (presencial) nunca avisa, mesmo com os outros campos de Pix", () => {
    expect(
      avisoDePixVencido(pixDoApp({ canal: "presencial" }), PRAZO_MS),
    ).toBeNull();
  });

  it("canal ausente (cache antigo) conta como online", () => {
    expect(
      avisoDePixVencido(pixDoApp({ canal: undefined }), PRAZO_MS),
    ).not.toBeNull();
  });

  it("sem prazo legível (ausente, vazio, lixo) não inventa aviso", () => {
    expect(
      avisoDePixVencido(pixDoApp({ expiraEm: undefined }), PRAZO_MS + 1e9),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ expiraEm: "" }), PRAZO_MS + 1e9),
    ).toBeNull();
    expect(
      avisoDePixVencido(pixDoApp({ expiraEm: "amanhã cedo" }), PRAZO_MS + 1e9),
    ).toBeNull();
  });

  it("prazo do Postgres com 6 dígitos de fração é lido no mesmo instante", () => {
    const longo = pixDoApp({ expiraEm: "2026-11-10T12:00:00.123456+00:00" });
    const base = Date.parse("2026-11-10T12:00:00.123Z");
    expect(avisoDePixVencido(longo, base)).not.toBeNull();
    expect(avisoDePixVencido(longo, base - 1)).toBeNull();
  });
});

describe("avisoDePixVencido — qual texto", () => {
  it("entrega comum: manda conferir com o cliente e cancelar se desistir", () => {
    const texto = avisoDePixVencido(pixDoApp(), PRAZO_MS) ?? "";
    expect(texto).toBe(
      "O Pix deste pedido venceu pelo horário previsto, mas o pagamento ainda não consta. Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.",
    );
  });

  it("retirada na loja: fala em liberar o estoque", () => {
    const texto =
      avisoDePixVencido(pixDoApp({ retiradaNaLoja: true }), PRAZO_MS) ?? "";
    expect(texto).toContain("liberar o estoque");
    expect(texto).toContain("Confira com o cliente.");
  });

  it("retirada cancelada depois de enviada volta ao texto comum (estoque não é mais da loja)", () => {
    const texto =
      avisoDePixVencido(
        pixDoApp({ retiradaNaLoja: true, cancelledAfterShipping: true }),
        PRAZO_MS,
      ) ?? "";
    expect(texto).not.toContain("liberar o estoque");
    expect(texto).toContain("Se decidir desistir");
  });
});

describe("aguardaPixOnline — confirmação ao avançar", () => {
  it("Pix do app aguardando em entrega comum: sim", () => {
    expect(aguardaPixOnline(pixDoApp())).toBe(true);
  });

  it("retirada na loja mantém o comportamento anterior: não", () => {
    expect(aguardaPixOnline(pixDoApp({ retiradaNaLoja: true }))).toBe(false);
  });

  it("balcão, outro método e outro estado de pagamento: não", () => {
    expect(aguardaPixOnline(pixDoApp({ canal: "presencial" }))).toBe(false);
    expect(aguardaPixOnline(pixDoApp({ metodoOnline: "debito" }))).toBe(false);
    expect(aguardaPixOnline(pixDoApp({ paymentMethod: "cash" }))).toBe(false);
    expect(aguardaPixOnline(pixDoApp({ paymentStatus: "pago" }))).toBe(false);
  });

  it("não depende do status do pedido nem do prazo (pedido pending ainda aguarda)", () => {
    expect(aguardaPixOnline(pixDoApp({ status: "pending" }))).toBe(true);
    expect(aguardaPixOnline(pixDoApp({ expiraEm: undefined }))).toBe(true);
  });
});

describe("AVISO_DE_RESERVA_AO_AVANCAR_PIX", () => {
  it("diz que avançar não confirma o Pix", () => {
    expect(AVISO_DE_RESERVA_AO_AVANCAR_PIX).toContain("não confirma o Pix");
  });
});
