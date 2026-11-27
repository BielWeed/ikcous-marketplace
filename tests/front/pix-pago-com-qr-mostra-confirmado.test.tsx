// @vitest-environment jsdom
//
// Caça de 26/11/2026: PIX já PAGO aparecia como aberto. A cliente paga no
// banco, a confirmação demora, ela volta por "Retomar pagamento" — e a
// reconsulta da edge (`criar-pagamento`, ramo (a)/(e)) devolve `pago` JUNTO
// com o QR da mesma cobrança. A tela desenhava o PIX inteiro, com "Copiar
// código Pix" e o passo a passo, até o CheckoutView trocar de tela (até
// ~10 s): tempo de sobra para pagar de novo. `pago`, com ou sem QR, é
// "Pagamento confirmado".
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFIRMADO = "Pagamento confirmado! Finalizando seu pedido…";
const COPIAR = "Copiar código Pix";

function respostaDoPix(extra: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    statusPagamento: "aguardando",
    expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    qrCode: "000201-codigo-copia-e-cola",
    qrCodeBase64: "abc123",
    ...extra,
  };
}

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("PagamentoOnline — PIX que a loja devolve como PAGO", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onErro: ReturnType<typeof vi.fn<(msg: string, cat: string) => void>>;

  beforeEach(() => {
    criarPagamento.mockReset();
    onErro = vi.fn<(msg: string, cat: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const texto = () => hospedeiro.textContent ?? "";
  const temQr = () =>
    hospedeiro.querySelector("img[alt='QR code do Pix']") !== null;

  async function mostrar() {
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-1"
          valor={100}
          onErro={onErro}
          onRelerPagamentoPix={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  it("pago COM QR (reconsulta depois de pagar): mostra a confirmação, sem código para copiar", async () => {
    criarPagamento.mockResolvedValue(
      respostaDoPix({ statusPagamento: "pago" }),
    );
    await mostrar();
    expect(texto()).toContain(CONFIRMADO);
    expect(texto()).not.toContain(COPIAR);
    expect(texto()).not.toContain("000201-codigo-copia-e-cola");
    expect(texto()).not.toContain("Abra o app do seu banco");
    expect(temQr()).toBe(false);
    expect(onErro).not.toHaveBeenCalled();
  });

  it("pago só com o copia-e-cola (sem a imagem): também confirmado", async () => {
    criarPagamento.mockResolvedValue(
      respostaDoPix({ statusPagamento: "pago", qrCodeBase64: undefined }),
    );
    await mostrar();
    expect(texto()).toContain(CONFIRMADO);
    expect(texto()).not.toContain(COPIAR);
  });

  it("controle: aguardando com QR mostra o PIX normal, com o botão de copiar", async () => {
    criarPagamento.mockResolvedValue(respostaDoPix());
    await mostrar();
    expect(texto()).toContain(COPIAR);
    expect(temQr()).toBe(true);
    expect(texto()).not.toContain(CONFIRMADO);
  });

  it("controle: pago sem QR continua confirmado", async () => {
    criarPagamento.mockResolvedValue(
      respostaDoPix({
        statusPagamento: "pago",
        qrCode: undefined,
        qrCodeBase64: undefined,
      }),
    );
    await mostrar();
    expect(texto()).toContain(CONFIRMADO);
    expect(onErro).not.toHaveBeenCalled();
  });

  it("controle: status desconhecido com QR continua erro, nunca confirmação", async () => {
    criarPagamento.mockResolvedValue(
      respostaDoPix({ statusPagamento: "approved:accredited" }),
    );
    await mostrar();
    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível confirmar o pagamento.",
      "terminal",
    );
    expect(texto()).not.toContain(CONFIRMADO);
    expect(texto()).not.toContain(COPIAR);
  });
});
