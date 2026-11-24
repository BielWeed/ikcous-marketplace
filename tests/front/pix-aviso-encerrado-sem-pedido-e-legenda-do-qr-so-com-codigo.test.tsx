// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) de dois detalhes da tela do PIX que nenhum
// teste vigiava:
// 1) o aviso de PIX encerrado só diz "Pedido #..." quando existe o número do
//    pedido. Trocar `orderId &&` por `true &&` não derrubava teste: com o id
//    vazio a cliente leria "Pedido #" solto, sem número nenhum;
// 2) a legenda "Pagando por outro aparelho? Escaneie o QR code." só vale
//    quando a tela TAMBÉM tem o copia e cola (é a escolha entre os dois
//    caminhos). Trocar `pix.qrCode &&` por `true &&` não derrubava teste: numa
//    cobrança que veio só com a imagem, a legenda sugeriria uma alternativa
//    que não existe nesta tela.
import {
  AvisoDePixEncerrado,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
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

const LEGENDA = "Pagando por outro aparelho? Escaneie o QR code.";
const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("tela do PIX — detalhes de texto", () => {
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

  it("aviso de PIX encerrado: com o número do pedido diz 'Pedido #...'; com o id vazio não escreve 'Pedido #' solto", async () => {
    await act(async () => {
      raiz.render(<AvisoDePixEncerrado orderId="ped-encerrado-1" />);
    });
    expect(hospedeiro.textContent).toContain("Pedido #");

    await act(async () => {
      raiz.render(<AvisoDePixEncerrado orderId="" />);
    });
    expect(hospedeiro.textContent).not.toContain("Pedido #");
    // O aviso em si continua lá.
    expect(hospedeiro.textContent).toContain("Este código não vale mais.");
  });

  async function mostrarPix(extra: Record<string, unknown>) {
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-legenda-1",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...extra,
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-legenda-1"
          valor={30}
          onErro={() => {}}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  it("com QR e copia e cola, a legenda 'Pagando por outro aparelho?' aparece", async () => {
    await mostrarPix({
      qrCode: "000201-codigo-copia-e-cola",
      qrCodeBase64: "abc123",
    });
    expect(hospedeiro.textContent).toContain(LEGENDA);
  });

  it("cobrança que veio só com a imagem do QR (sem copia e cola): a imagem aparece, a legenda NÃO", async () => {
    await mostrarPix({ qrCode: undefined, qrCodeBase64: "abc123" });
    expect(
      hospedeiro.querySelector("img[alt='QR code do Pix']"),
    ).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(LEGENDA);
  });
});
