// @vitest-environment jsdom
//
// Controle negativo do achado 2 do laudo da rodada 2 (metade A) — "pedido novo
// não entra na lista". A recarga ao voltar para a aba visível pendurava DUAS
// dependências que a matavam: `isLeader` (a aba não-líder nem agendava) e a
// guarda de `refCount` (a líder com canal vivo pulava). A revisão de 26/08
// reverteu a rodada 2 e NOMEOU o conserto: efeito próprio, dependências
// `[enabled, user?.id, isAdmin]`, SEM `isLeader` — ver
// `~/.claude/mural/core_app_mkt/frentes/vitrine-sabe-que-o-produto-mudou.md`.
// (Rodada 4, revisão do PR 321: as deps honestas são `[enabled]` — o corpo não
// lê as outras duas, e cada mudança delas derrubava o timer pendente.)
//
// ⚠️ A ARMADILHA que a rodada 2 caiu, evitada aqui DE PROPÓSITO: o commit do
// React acontece num `act` SEPARADO do avanço do relógio. Fundidos num `act`
// só, o React descarrega efeitos passivos DEPOIS do timer, a ordem da
// produção se inverte e este teste passaria verde com o defeito intacto.
//
// Os dois primeiros cenários devem FALHAR no código sem conserto (prova de
// que o defeito existe hoje) e PASSAR com o efeito próprio. O terceiro prova o
// conserto do BLOQUEIA da revisão do PR 321: a recarga por visibilidade é
// background refresh e é SILENCIOSA — erro na consulta não vira toast.

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lideranca = vi.hoisted(() => ({ isLeader: false }));
const chamadasFrom = vi.hoisted(() => ({ marketplaceOrders: 0 }));
const visibilidade = vi.hoisted(() => ({ estado: "visible" }));
const resposta = vi.hoisted(() => ({ erro: false }));
const toasts = vi.hoisted(() => ({ erro: vi.fn() }));

vi.mock("@/lib/supabase", () => {
  const builder = () => {
    const corpo = resposta.erro
      ? { data: null, error: { message: "boom" }, count: 0 }
      : { data: [], error: null, count: 0 };
    const promessa = Promise.resolve(corpo);
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      abortSignal: () => alvo,
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
  toast: { error: toasts.erro, success: vi.fn(), info: vi.fn() },
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

function disparaVisibilidade() {
  // Fiel à produção: o navegador dispara em `document` com bubbles, e é o
  // borbulhar até o `window` que alcança o listener em `globalThis`.
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

describe("useOrders — recarga ao voltar para a aba visível (sem depender de liderança)", () => {
  let root: Root | null = null;
  let descritorOriginal: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    chamadasFrom.marketplaceOrders = 0;
    lideranca.isLeader = false;
    resposta.erro = false;
    visibilidade.estado = "visible";
    toasts.erro.mockClear();
    if (typeof (globalThis as any).BroadcastChannel === "undefined") {
      (globalThis as any).BroadcastChannel = BroadcastChannelStub;
    }
    // O localStorage do node 25 nasce quebrado sem `--localstorage-file`
    // (existe, mas sem métodos). O hook lê cache dele no mount. Map em vez de
    // objeto indexado para não somar warning de object-injection (teto do CI).
    const memoria = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memoria.set(k, String(v));
        },
        removeItem: (k: string) => {
          memoria.delete(k);
        },
        clear: () => memoria.clear(),
      },
    });
    descritorOriginal = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade.estado,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    if (descritorOriginal) {
      Object.defineProperty(document, "visibilityState", descritorOriginal);
    }
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

  it("aba NÃO-líder: volta ao visível recarrega EXATAMENTE 1 vez; ir para hidden não recarrega", async () => {
    lideranca.isLeader = false;
    montar();
    const antes = contagemNova();

    visibilidade.estado = "hidden";
    act(() => {
      disparaVisibilidade();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});
    expect(contagemNova()).toBe(antes); // hidden não agenda nada

    visibilidade.estado = "visible";
    act(() => {
      disparaVisibilidade();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});
    expect(contagemNova()).toBe(antes + 1); // exatamente 1: debounce sem duplicar
  });

  it("aba LÍDER com canal vivo que volta ao visível recarrega EXATAMENTE 1 vez", async () => {
    lideranca.isLeader = true;
    montar();
    const antes = contagemNova();

    act(() => {
      disparaVisibilidade();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});
    expect(contagemNova()).toBe(antes + 1);
  });

  it("a recarga por visibilidade é SILENCIOSA: erro na consulta não vira toast (BLOQUEIA do PR 321)", async () => {
    lideranca.isLeader = false;
    resposta.erro = true;
    montar();
    const antes = contagemNova();

    act(() => {
      disparaVisibilidade();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    // O refresh ACONTECEU (a consulta voou), mas o erro de background não
    // fala com o usuário: nenhum toast por cima da tela do PIX.
    expect(contagemNova()).toBe(antes + 1);
    expect(toasts.erro).not.toHaveBeenCalled();
  });
});
