// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadas: 0,
  status: null as ((status: string) => void) | null,
  evento: null as (() => void) | null,
  estado: null as null | { painel: unknown; desatualizado: boolean },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-fixture" } } }),
}));
vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: () => "Falha de leitura",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) =>
      Promise.resolve({
        data: nome === "painel_inicio" ? { total: ++h.chamadas } : null,
        error: null,
      }),
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, evento: () => void) => {
          h.evento = evento;
          return canal;
        },
        subscribe: (status: (status: string) => void) => {
          h.status = status;
          return canal;
        },
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Início relê os pedidos perdidos na queda do canal", () => {
  let raiz: Root;
  let div: HTMLDivElement;

  async function passar(ms = 2000) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  }

  async function emitir(status: string) {
    await act(async () => h.status?.(status));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    h.chamadas = 0;
    h.status = null;
    h.evento = null;
    h.estado = null;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    div = document.createElement("div");
    document.body.appendChild(div);
    raiz = createRoot(div);
    const { usePainelInicio } = await import("@/hooks/usePainelInicio");
    function Sonda() {
      const estado = usePainelInicio(true);
      useEffect(() => {
        h.estado = estado;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    await passar(250);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    div.remove();
    vi.useRealTimers();
  });

  it("não anuncia Ao vivo antes de confirmar a assinatura", async () => {
    expect(h.estado?.desatualizado).toBe(true);
    await emitir("SUBSCRIBED");
    expect(h.estado?.desatualizado).toBe(false);
  });

  it("controle: a primeira assinatura e status repetido não duplicam a abertura", async () => {
    expect(h.chamadas).toBe(1);
    await emitir("SUBSCRIBED");
    await emitir("SUBSCRIBED");
    await passar();
    expect(h.chamadas).toBe(1);
    expect(h.estado?.desatualizado).toBe(false);
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "%s tira o Ao vivo e a reconexão busca números novos uma vez",
    async (queda) => {
      await emitir("SUBSCRIBED");
      const antes = h.estado?.painel;
      await emitir(queda);
      expect(h.estado?.desatualizado).toBe(true);
      expect(h.estado?.painel).toBe(antes);
      await emitir("SUBSCRIBED");
      await emitir("SUBSCRIBED");
      await passar();
      expect(h.chamadas).toBe(2);
      expect(h.estado?.painel).toEqual({ total: 2 });
      expect(h.estado?.desatualizado).toBe(false);
    },
  );

  it("reconexão escondida espera a tela voltar e então relê", async () => {
    await emitir("SUBSCRIBED");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await emitir("CLOSED");
    await emitir("SUBSCRIBED");
    await passar();
    expect(h.chamadas).toBe(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await passar();
    expect(h.chamadas).toBe(2);
  });

  it("o callback antigo não busca depois de desmontar", async () => {
    await emitir("SUBSCRIBED");
    const callbackAntigo = h.status;
    act(() => raiz.render(null));
    await act(async () => {
      callbackAntigo?.("CLOSED");
      callbackAntigo?.("SUBSCRIBED");
    });
    await passar();
    expect(h.chamadas).toBe(1);
  });
});
