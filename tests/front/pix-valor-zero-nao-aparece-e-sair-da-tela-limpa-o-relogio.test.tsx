// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) da tela do PIX (`PagamentoComPix`).
//
// 1) O valor em reais só aparece quando é um valor de verdade (> 0). Trocar
//    `valor > 0` por `valor >= 0` não derrubava teste nenhum: um pedido que
//    chegasse à tela com valor 0 (ou lixo) mostraria "R$ 0,00" em letras
//    grandes — a cliente leria que o PIX é de zero reais.
// 2) Sair da tela do PIX apaga o relógio de 10 s (o que reavalia o aviso do
//    horário) e solta o ouvinte de `visibilitychange`. Tirar qualquer um dos
//    dois na limpeza não derrubava teste: cada PIX aberto e fechado deixaria
//    um relógio e um ouvinte vivos para sempre, atualizando uma tela morta.
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

function respostaDoPix() {
  return {
    paymentId: "pay-valor-1",
    statusPagamento: "aguardando",
    expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    qrCode: "000201-codigo-copia-e-cola",
    qrCodeBase64: "abc123",
  };
}

describe("tela do PIX — valor e limpeza ao sair", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let desmontada: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    criarPagamento.mockReset();
    criarPagamento.mockResolvedValue(respostaDoPix());
    desmontada = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    if (!desmontada) {
      act(() => {
        raiz.unmount();
      });
    }
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function mostrar(valor: number) {
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-valor-1"
          valor={valor}
          onErro={() => {}}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    // Controle de que o PIX chegou: o QR está na tela.
    expect(
      hospedeiro.querySelector("img[alt='QR code do Pix']"),
    ).not.toBeNull();
  }

  it("valor 0, negativo ou ilegível: o PIX aparece mas o valor em reais NÃO (nada de 'R$ 0,00' em letras grandes)", async () => {
    for (const ruim of [0, -5, Number.NaN]) {
      await mostrar(ruim);
      expect(hospedeiro.textContent).not.toMatch(/R\$/);
      await act(async () => {
        raiz.render(null);
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  });

  it("CONTROLE: o menor valor possível (R$ 0,01) aparece — a fronteira é '> 0', não '> 1'", async () => {
    await mostrar(0.01);
    expect(hospedeiro.textContent).toMatch(/R\$\s*0,01/);
  });

  it("sair da tela do PIX apaga o relógio de 10 s e solta o ouvinte de visibilitychange", async () => {
    const adicionar = vi.spyOn(document, "addEventListener");
    const remover = vi.spyOn(document, "removeEventListener");
    await mostrar(100);

    const ouvintes = adicionar.mock.calls
      .filter(([tipo]) => tipo === "visibilitychange")
      .map(([, ouvinte]) => ouvinte);
    expect(ouvintes.length).toBeGreaterThan(0);
    // Controle: com a tela aberta o relógio de 10 s está vivo.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      raiz.unmount();
    });
    desmontada = true;

    const soltos = remover.mock.calls
      .filter(([tipo]) => tipo === "visibilitychange")
      .map(([, ouvinte]) => ouvinte);
    for (const ouvinte of ouvintes) expect(soltos).toContain(ouvinte);
    expect(vi.getTimerCount()).toBe(0);
  });
});
