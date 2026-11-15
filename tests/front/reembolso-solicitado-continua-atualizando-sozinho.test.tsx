// @vitest-environment jsdom
//
// A tela do pedido cancelado e pago online mostra o reembolso e o mantém em
// dia SOZINHA, sem a cliente recarregar a página (`order_refunds` não está no
// realtime): enquanto houver devolução `solicitado` ou `em_processamento`, o
// hook relê a cada 15 s; quando tudo está resolvido, para de reler. Aqui a tela
// fica aberta (sem desmontar), o relógio é falso e o dublê do banco só conta as
// leituras e devolve o que a loja gravou até ali.
import { useDevolucaoDoPedidoCliente } from "@/hooks/useDevolucaoDoPedidoCliente";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ler: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => h.ler() }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INTERVALO_DE_RECARGA_MS = 15_000;

const devolucao = (status: string) => ({
  amount: 50,
  status,
  solicitado_por: "cliente",
  concluido_em: status === "concluido" ? "2026-11-13T12:00:00Z" : null,
});

describe("devolução do pedido na tela da cliente: atualiza sozinha enquanto está em curso", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let atual!: ReturnType<typeof useDevolucaoDoPedidoCliente>;

  async function montar() {
    function Sonda() {
      const valor = useDevolucaoDoPedidoCliente("pedido-1", true);
      useEffect(() => {
        atual = valor;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
  }

  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    h.ler.mockReset();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    alvo.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("`solicitado` + 15 s sem desmontar: lê de novo e mostra o estado novo", async () => {
    h.ler
      .mockResolvedValueOnce({ data: [devolucao("solicitado")], error: null })
      .mockResolvedValue({ data: [devolucao("concluido")], error: null });
    await montar();
    expect(h.ler).toHaveBeenCalledTimes(1);
    expect(atual.linhas.map((l) => l.status)).toEqual(["solicitado"]);

    await avancar(INTERVALO_DE_RECARGA_MS);

    expect(h.ler).toHaveBeenCalledTimes(2);
    expect(atual.linhas.map((l) => l.status)).toEqual(["concluido"]);
  });

  it("`em_processamento` + 15 s sem desmontar: lê de novo e mostra o estado novo", async () => {
    h.ler
      .mockResolvedValueOnce({
        data: [devolucao("em_processamento")],
        error: null,
      })
      .mockResolvedValue({ data: [devolucao("concluido")], error: null });
    await montar();

    await avancar(INTERVALO_DE_RECARGA_MS);

    expect(h.ler).toHaveBeenCalledTimes(2);
    expect(atual.linhas.map((l) => l.status)).toEqual(["concluido"]);
  });

  it("duas devoluções, uma `concluido` e outra em curso: segue relendo até a em curso terminar", async () => {
    h.ler
      .mockResolvedValueOnce({
        data: [devolucao("concluido"), devolucao("solicitado")],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [devolucao("concluido"), devolucao("em_processamento")],
        error: null,
      })
      .mockResolvedValue({
        data: [devolucao("concluido"), devolucao("concluido")],
        error: null,
      });
    await montar();
    expect(h.ler).toHaveBeenCalledTimes(1);

    await avancar(INTERVALO_DE_RECARGA_MS);
    expect(h.ler).toHaveBeenCalledTimes(2);
    expect(atual.linhas.map((l) => l.status)).toEqual([
      "concluido",
      "em_processamento",
    ]);

    await avancar(INTERVALO_DE_RECARGA_MS);
    expect(h.ler).toHaveBeenCalledTimes(3);
    expect(atual.linhas.map((l) => l.status)).toEqual([
      "concluido",
      "concluido",
    ]);

    // Tudo resolvido: aí sim para de reler.
    await avancar(INTERVALO_DE_RECARGA_MS * 4);
    expect(h.ler).toHaveBeenCalledTimes(3);
  });

  it("CONTROLE: ao ficar `concluido` para de reler (nada em voo)", async () => {
    h.ler
      .mockResolvedValueOnce({ data: [devolucao("solicitado")], error: null })
      .mockResolvedValue({ data: [devolucao("concluido")], error: null });
    await montar();
    await avancar(INTERVALO_DE_RECARGA_MS);
    expect(h.ler).toHaveBeenCalledTimes(2);

    await avancar(INTERVALO_DE_RECARGA_MS * 4);

    expect(h.ler).toHaveBeenCalledTimes(2);
  });

  it("CONTROLE: devolução já `concluido` ao abrir não relê sozinha", async () => {
    h.ler.mockResolvedValue({ data: [devolucao("concluido")], error: null });
    await montar();
    expect(h.ler).toHaveBeenCalledTimes(1);

    await avancar(INTERVALO_DE_RECARGA_MS * 4);

    expect(h.ler).toHaveBeenCalledTimes(1);
    expect(atual.linhas.map((l) => l.status)).toEqual(["concluido"]);
  });
});
