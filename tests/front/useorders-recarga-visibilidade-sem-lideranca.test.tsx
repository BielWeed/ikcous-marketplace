// @vitest-environment jsdom
//
// Controle negativo do achado 2 do laudo da rodada 2 (metade A) — "pedido novo
// não entra na lista". A recarga ao voltar para a aba visível pendurava DUAS
// dependências que a matavam: `isLeader` (a aba não-líder nem agendava) e a
// guarda de `refCount` (a líder com canal vivo pulava). A revisão de 26/08
// reverteu a rodada 2 e NOMEOU o conserto: efeito próprio, dependências
// `[enabled, user?.id, isAdmin]`, SEM `isLeader` — ver
// `~/.claude/mural/core_app_mkt/frentes/vitrine-sabe-que-o-produto-mudou.md`.
//
// ⚠️ A ARMADILHA que a rodada 2 caiu, evitada aqui DE PROPÓSITO: o commit do
// React acontece num `act` SEPARADO do avanço do relógio. Fundidos num `act`
// só, o React descarrega efeitos passivos DEPOIS do timer, a ordem da
// produção se inverte e este teste passaria verde com o defeito intacto.
//
// Os dois cenários abaixo devem FALHAR no código sem conserto (prova de que o
// defeito existe hoje) e PASSAR com o efeito próprio.

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lideranca = vi.hoisted(() => ({ isLeader: false }));
const chamadasFrom = vi.hoisted(() => ({ marketplaceOrders: 0 }));

vi.mock("@/lib/supabase", () => {
  const builder = () => {
    const resolvido = { data: [], error: null, count: 0 };
    const promessa = Promise.resolve(resolvido);
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // Mock awaitable: o hook usa `await` de verdade na consulta. A regra
    // noThenProperty proíbe `then` em literal, assignment E defineProperty
    // (medido) — aqui o `then` é o próprio propósito do objeto (mock de
    // consulta), então o disable carrega o motivo.
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        promessa.then(res, rej),
    });
    return alvo;
  };
  const canal = () => {
    const alvo: Record<string, unknown> = {
      on: () => alvo,
      subscribe: (cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return alvo;
      },
    };
    return alvo;
  };
  return {
    supabase: {
      from: (tabela: string) => {
        if (tabela === "marketplace_orders") chamadasFrom.marketplaceOrders++;
        return builder();
      },
      rpc: () => builder(),
      channel: () => canal(),
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: lideranca.isLeader }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

// Os `act` deste teste mexem em efeitos com timers — o React exige o sinal
// de ambiente de teste para aceitá-los sem aviso (e sem pular a descarga).
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom pode não ter BroadcastChannel — o hook cria um no mount.
const BroadcastChannelStub = class {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
};

function Alvo() {
  useOrders(true);
  return null;
}

describe("useOrders — recarga ao voltar para a aba visível (sem depender de liderança)", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    chamadasFrom.marketplaceOrders = 0;
    lideranca.isLeader = false;
    if (typeof (globalThis as any).BroadcastChannel === "undefined") {
      (globalThis as any).BroadcastChannel = BroadcastChannelStub;
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const montar = () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);
    act(() => {
      root!.render(<Alvo />);
    });
  };

  const contagemNova = () => chamadasFrom.marketplaceOrders;

  it("aba NÃO-líder que volta ao visível recarrega a lista", async () => {
    lideranca.isLeader = false;
    montar();
    const antes = contagemNova();

    act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(contagemNova()).toBeGreaterThan(antes);
  });

  it("aba LÍDER com canal vivo que volta ao visível recarrega a lista", async () => {
    lideranca.isLeader = true;
    montar();
    const antes = contagemNova();

    act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(contagemNova()).toBeGreaterThan(antes);
  });
});
