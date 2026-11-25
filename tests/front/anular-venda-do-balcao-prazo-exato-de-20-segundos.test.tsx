// @vitest-environment jsdom
//
// `useAnularVendaDoBalcao`: a anulação sem resposta solta a lojista em
// exatamente 20 s (o mesmo prazo do registro da venda no balcão) — o teste de
// rede pendurada usa a constante exportada, então só este fixa o número.
// Aqui o relógio anda 19,999 s (ainda esperando) e depois 1 ms (estourou).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, limparCacheMock, avisarMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(nome: string, args: unknown) => Promise<unknown>>(),
  limparCacheMock: vi.fn<() => void>(),
  avisarMock: vi.fn<(orderId: string) => void>(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: limparCacheMock,
}));
vi.mock("@/lib/avisa-anulacao-do-balcao", () => ({
  avisarAnulacao: avisarMock,
}));

import { useAnularVendaDoBalcao } from "@/hooks/useAnularVendaDoBalcao";

let anular: ReturnType<typeof useAnularVendaDoBalcao>["anular"];
function Sonda() {
  const { anular: anularDoHook } = useAnularVendaDoBalcao();
  useEffect(() => {
    anular = anularDoHook;
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(async () => {
  vi.useFakeTimers();
  rpcMock.mockReset();
  limparCacheMock.mockReset();
  avisarMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Sonda />);
  });
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useAnularVendaDoBalcao — o prazo é de 20 s", () => {
  it("sem resposta: espera 19,999 s e só em 20 s rejeita (sem limpar cache nem avisar a lista)", async () => {
    rpcMock.mockImplementation(() => new Promise<unknown>(() => {}));
    let veredito: "pendente" | "rejeitou" | "resolveu" = "pendente";
    let motivoDaFalha: unknown;
    void anular("p1", "engano").then(
      () => {
        veredito = "resolveu";
      },
      (erro: unknown) => {
        veredito = "rejeitou";
        motivoDaFalha = erro;
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(veredito).toBe("pendente");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(veredito).toBe("rejeitou");
    expect(motivoDaFalha).toBeInstanceOf(Error);
    expect((motivoDaFalha as Error).message).toBe(
      "A anulação não respondeu a tempo.",
    );
    expect(limparCacheMock).not.toHaveBeenCalled();
    expect(avisarMock).not.toHaveBeenCalled();
  });

  it("resposta dentro do prazo anula: limpa o cache do painel e avisa a lista", async () => {
    rpcMock.mockResolvedValue({
      data: { order_id: "p1", ja_anulada: false },
      error: null,
    });
    let resultado: Awaited<ReturnType<typeof anular>> | undefined;
    await act(async () => {
      resultado = await anular("p1", "engano");
    });
    expect(resultado).toEqual({ orderId: "p1", jaAnulada: false });
    expect(limparCacheMock).toHaveBeenCalledTimes(1);
    expect(avisarMock).toHaveBeenCalledWith("p1");
  });
});
