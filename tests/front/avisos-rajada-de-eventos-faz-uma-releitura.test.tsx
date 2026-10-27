// @vitest-environment jsdom
//
// Lote 226 (item 6): "Marcar todas como lidas" com 10 avisos vira 10 eventos
// ao vivo de uma vez, e cada evento disparava uma releitura completa (2
// consultas) — 20 consultas em vez de 2. A rajada tem de virar UMA releitura.
import { NotificationProvider } from "@/contexts/NotificationContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => {
  const sessao = { user: { id: "cliente-1" } };
  return { useAuth: () => sessao };
});

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

const h = vi.hoisted(() => ({
  consultas: 0,
  aoMudar: null as null | (() => void),
}));

function builder() {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(async () => ({ data: [], error: null })),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      h.consultas += 1;
      return builder();
    },
    channel: () => {
      const canal = {
        on: (_e: string, _o: unknown, cb: () => void) => {
          h.aoMudar = cb;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("avisos: rajada de eventos ao vivo gera uma só releitura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.consultas = 0;
    h.aoMudar = null;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: unknown = null;
        postMessage() {}
        close() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("10 eventos seguidos -> 1 releitura (2 consultas), não 10", async () => {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <span />
        </NotificationProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const aoMudar = h.aoMudar as null | (() => void);
    expect(aoMudar).toBeTypeOf("function");
    const antes = h.consultas; // leitura inicial (2 consultas)

    await act(async () => {
      for (let i = 0; i < 10; i++) aoMudar?.();
      await new Promise((r) => setTimeout(r, 900));
    });

    expect(h.consultas - antes).toBe(2);
  });
});
