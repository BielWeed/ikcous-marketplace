// @vitest-environment jsdom
//
// F6 (fase 3 dos pagamentos, 04/10/2026) — o mesmo pedido aparecia como
// "Pedido #c35ce4dd" no formulário de pagamento e "#3884BE" na tela final: o
// cliente não reconhecia que era o mesmo. Todas as telas do cliente mostram o
// número no padrão da loja (6 últimos, maiúsculas — `numeroDoPedido`). Só o
// TEXTO muda: o id inteiro continua sendo o que vai à edge e ao Mercado Pago.
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

const PEDIDO = "c35ce4dd-1234-4abc-8def-1a2b3c3884be";
const NUMERO = "#3884BE";
const ANTIGO = "#c35ce4dd"; // os 8 primeiros, que o cliente não reconhecia

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
  vi.restoreAllMocks();
});

async function drenar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("número do pedido nas telas de pagamento", () => {
  it("PIX: 'Pedido #3884BE', e o id inteiro segue indo à edge", async () => {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId={PEDIDO} valor={100} onErro={() => {}} />,
      );
    });
    await drenar();

    expect(hospedeiro.textContent).toContain(`Pedido ${NUMERO}`);
    expect(hospedeiro.textContent).not.toContain(ANTIGO);
    expect(criarPagamento).toHaveBeenCalledWith({
      orderId: PEDIDO,
      metodo: "pix",
    });
  });

  it("PIX com o pedido morto no servidor: o mesmo número", async () => {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={PEDIDO}
          valor={100}
          onErro={() => {}}
          pedidoMortoNoServidor
        />,
      );
    });
    await drenar();

    expect(hospedeiro.textContent).toContain(`Pedido ${NUMERO}`);
    expect(hospedeiro.textContent).not.toContain(ANTIGO);
  });

  it("cartão: o mesmo número, no mesmo formato", async () => {
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={PEDIDO}
          valor={100}
          metodo="cartao"
          configDoCartao={{ credito: true, debito: false, parcelasMax: 6 }}
          emailDoPagador="cliente@exemplo.com"
          onErro={() => {}}
        />,
      );
    });
    await drenar();

    expect(hospedeiro.textContent).toContain(`Pedido ${NUMERO}`);
    expect(hospedeiro.textContent).not.toContain(ANTIGO);
  });
});
