// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) da tela do PIX: o relógio do aviso de horário
// nasce na montagem da tela, mas o QR pode chegar muito depois (rede lenta).
// Tirar o `setAgora(Date.now())` do `onPix` não derrubava teste nenhum: o QR
// que chega JÁ além do horário previsto mostraria "Prazo informado: até 15:30"
// (um horário que já passou) por até 10 s, até o primeiro tique do relógio —
// o certo é a tela nascer com o aviso prudente de que o horário passou.
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

const AVISO_PASSOU = "O horário previsto para pagar já passou.";

describe("PIX — QR que chega depois do horário previsto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
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
    vi.useRealTimers();
  });

  it("a tela abre às 12:00:00, o QR chega 15 s depois com prazo até 12:00:10: já nasce com o aviso (sem esperar o tique de 10 s) e sem a caixa 'Prazo informado'", async () => {
    let chegou: (resposta: unknown) => void = () => {};
    criarPagamento.mockReturnValue(
      new Promise((resolve) => {
        chegou = resolve;
      }),
    );
    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-tarde-1" valor={80} onErro={() => {}} />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    // Ainda gerando o QR: sem aviso nenhum.
    expect(hospedeiro.textContent).toContain("Gerando o QR code do Pix");

    // Passam 15 s (abaixo dos 20 s do tempo limite da criação).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => {
      chegou({
        paymentId: "pay-tarde-1",
        statusPagamento: "aguardando",
        expiraEm: "2026-11-24T12:00:10.000Z",
        qrCode: "000201-codigo-copia-e-cola",
        qrCodeBase64: "abc123",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      hospedeiro.querySelector("img[alt='QR code do Pix']"),
    ).not.toBeNull();
    expect(hospedeiro.textContent).toContain(AVISO_PASSOU);
    expect(hospedeiro.textContent).not.toContain("Prazo informado");
  });

  it("CONTROLE: o mesmo atraso com prazo ainda no futuro (12:30) mostra o prazo, sem aviso", async () => {
    let chegou: (resposta: unknown) => void = () => {};
    criarPagamento.mockReturnValue(
      new Promise((resolve) => {
        chegou = resolve;
      }),
    );
    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-tarde-2" valor={80} onErro={() => {}} />,
      );
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => {
      chegou({
        paymentId: "pay-tarde-2",
        statusPagamento: "aguardando",
        expiraEm: "2026-11-24T12:30:00.000Z",
        qrCode: "000201-codigo-copia-e-cola",
        qrCodeBase64: "abc123",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hospedeiro.textContent).toContain("Prazo informado");
    expect(hospedeiro.textContent).not.toContain(AVISO_PASSOU);
  });
});
