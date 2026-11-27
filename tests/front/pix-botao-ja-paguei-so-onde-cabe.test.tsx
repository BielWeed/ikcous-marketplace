// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) do botão "Já paguei — verificar" da tela do
// PIX. O botão pergunta à loja se ESTE pedido foi pago; se ele aparecer onde
// a pergunta não faz sentido, a cliente confere o pedido errado ou "confere"
// um PIX que já está pago. Tirar `pix.aguardando` ou `pix.orderId === orderId`
// da condição não derrubava nenhum teste: os existentes só provam o botão no
// caminho feliz (PIX aguardando, do pedido da tela).
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

const ROTULO = "Já paguei — verificar";

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

describe("PagamentoOnline — botão 'Já paguei — verificar' só onde faz sentido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    criarPagamento.mockReset();
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

  const temBotao = () => (hospedeiro.textContent ?? "").includes(ROTULO);

  async function mostrar(orderId: string) {
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={orderId}
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  it("PIX que a loja já devolveu como PAGO (com QR) não oferece 'Já paguei'", async () => {
    criarPagamento.mockResolvedValue(
      respostaDoPix({ statusPagamento: "pago" }),
    );
    await mostrar("ped-1");
    // Desde 26/11/2026 o PIX pago nem chega a ser desenhado: vira a
    // confirmação (pix-pago-com-qr-mostra-confirmado.test.tsx). Não há o que
    // verificar — o pedido já está pago.
    expect(hospedeiro.querySelector("img[alt='QR code do Pix']")).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Pagamento confirmado! Finalizando seu pedido…",
    );
    expect(temBotao()).toBe(false);
  });

  it("enquanto o PIX do pedido NOVO não chega, o QR de outro pedido não ganha o botão de verificar o novo", async () => {
    // Controle: PIX aguardando do pedido da tela oferece o botão.
    criarPagamento.mockResolvedValueOnce(respostaDoPix());
    await mostrar("ped-1");
    expect(temBotao()).toBe(true);

    // A troca de pedido dispara outra cobrança, que fica pendurada.
    let chegou: (v: unknown) => void = () => {};
    criarPagamento.mockReturnValueOnce(
      new Promise((resolve) => {
        chegou = resolve;
      }),
    );
    await mostrar("ped-2");
    expect(temBotao()).toBe(false);

    // Controle: quando o PIX do pedido novo chega, o botão volta.
    await act(async () => {
      chegou(respostaDoPix({ paymentId: "pay-2" }));
      await esperar();
    });
    expect(temBotao()).toBe(true);
  });
});
