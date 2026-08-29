// @vitest-environment jsdom
//
// Trava do conserto do BLOQUEIA 2 do #321 (achado da 3ª janela de revisão,
// confirmado na develop): o `silent` do `loadOrders` só pula o esqueleto de
// carregamento — o `toast.error` do ramo de erro era INCONDICIONAL, então a
// recarga silenciosa do painel do lojista (o ramo admin da recarga força
// silent=true) tocava a tarja vermelha sem ela ter pedido nada. O comentário
// do próprio hook (:184, "silent forçado para true no modo admin: a recarga
// acontece sem ela") prometia o que o catch não cumpria.
//
// O conserto é a mesma disciplina da `fetchUserOrders` (:920): `if (!silent)
// toast.error(...)` — some o aviso da recarga de fundo, NÃO some a falha
// (console.error segue incondicional e o erro continua sendo devolvido).
// Este arquivo prende os DOIS lados: silencioso não tosta, e carga pedida
// (sem silent) CONTINUA tostando — a trava morre se alguém alargar o
// silêncio para além da recarga de fundo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resposta = vi.hoisted(() => ({ erro: false }));
const toasts = vi.hoisted(() => ({ erro: vi.fn() }));
const exposto = vi.hoisted(() => ({
  loadOrders: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

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
      from: () => builder(),
      rpc: () => builder(),
      channel: () => canal(),
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: toasts.erro, success: vi.fn(), info: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Alvo() {
  const hook = useOrders(true, true);
  // No efeito, não no render: o eslint (react-hooks/immutability) não deixa
  // o corpo do componente escrever em objeto de fora — e o efeito roda depois
  // de cada render, então o `loadOrders` exposto é sempre o atual.
  useEffect(() => {
    exposto.loadOrders = hook.loadOrders as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;
  });
  return null;
}

describe("loadOrders — o silent do painel do lojista é respeitado no erro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    toasts.erro.mockClear();
    resposta.erro = true;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(<Alvo />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("recarga SILENCIOSA com erro: NÃO tosta (o BLOQUEIA 2 do #321)", async () => {
    await act(async () => {
      await exposto.loadOrders!(
        0,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
    });
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("carga PEDIDA (sem silent) com erro: CONTINUA tostando — o conserto não pode alargar o silêncio", async () => {
    await act(async () => {
      await exposto.loadOrders!(0, 20);
    });
    expect(toasts.erro).toHaveBeenCalledWith("Erro ao carregar pedidos");
  });
});
