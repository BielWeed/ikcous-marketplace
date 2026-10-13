// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `usePainelInicio`: `buscarCoalescido`
// devolve a busca em voo para QUALQUER chamador, inclusive o `carregar(true)`
// do tempo real. Se a busca começou antes de um pedido mudar (hover/abertura
// lentos) e a mudança chega durante o voo, a recarga forçada reaproveita a
// busca velha e o retrato anterior à mudança é gravado no cache como fresco:
// o Início segue sem o pedido novo. A recarga FORÇADA tem de rodar uma busca
// depois da que estava em voo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  painel: [] as Array<(r: unknown) => void>,
  chamadasPainel: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } } }),
}));

vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: (_e: unknown, o: string) => `erro ao ${o}`,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      if (nome === "painel_inicio") {
        h.chamadasPainel += 1;
        return new Promise((resolve) => {
          h.painel.push((data) => resolve({ data, error: null }));
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("usePainelInicio — recarga forçada depois de uma busca em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    h.painel.length = 0;
    h.chamadasPainel = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const mod = await import("@/hooks/usePainelInicio");
    const saida: { atual: ReturnType<typeof mod.usePainelInicio> | null } = {
      atual: null,
    };
    function Sonda() {
      const estado = mod.usePainelInicio(false);
      useEffect(() => {
        saida.atual = estado;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    return { mod, saida };
  }

  it("a recarga forçada com busca em voo roda UMA busca nova depois dela", async () => {
    const { mod, saida } = await montar();
    mod.prefetchPainelInicio(); // busca 1 em voo (hover lento)
    expect(h.chamadasPainel).toBe(1);

    // Um pedido muda durante o voo: o tempo real força a recarga.
    let terminou = false;
    const forcada = saida.atual?.atualizar().then(() => {
      terminou = true;
    });
    expect(terminou).toBe(false);

    await act(async () => {
      h.painel[0]({ total: 1 }); // a busca 1 (anterior à mudança) termina
      await Promise.resolve();
      await Promise.resolve();
    });
    // A busca forçada ainda tem de rodar: uma segunda chamada ao servidor.
    expect(h.chamadasPainel).toBe(2);

    await act(async () => {
      h.painel[1]({ total: 2 });
      await forcada;
    });
    expect(saida.atual?.painel).toEqual({ total: 2 });
  });

  it("controle: sem busca em voo, a recarga forçada busca uma vez", async () => {
    const { saida } = await montar();
    const forcada = saida.atual?.atualizar();
    expect(h.chamadasPainel).toBe(1);
    await act(async () => {
      h.painel[0]({ total: 5 });
      await forcada;
    });
    expect(saida.atual?.painel).toEqual({ total: 5 });
  });
});
