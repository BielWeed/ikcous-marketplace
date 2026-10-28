// @vitest-environment jsdom
//
// Lote 242 (caça 12-A #4): depois de ENTRAR na conta sem recarregar, o carrinho
// diz que está carregando até a leitura da conta terminar.
//
// DEFEITO MEDIDO: `isLoading` nascia `true` só na abertura do app. Quem abria o
// app como visitante (carrinho vazio, `isLoading` falso) e entrava na conta, ou
// saía de uma conta e entrava em outra, via "Seu carrinho está vazio" até a
// leitura do banco acabar — depois os itens apareciam. O teste de tela da
// 1.5.91 simula o `useCart` e não pega isto: aqui o CartContext é o REAL e a
// troca de conta é de verdade.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Leitura = { data: unknown; error: unknown };

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  // A leitura do carrinho da conta fica PENDURADA até o teste soltar.
  soltarLeitura: [] as Array<(v: Leitura) => void>,
  rejeitarLeitura: [] as Array<(e: Error) => void>,
  segurarLeitura: false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          if (tabela === "cart_items" && mundo.segurarLeitura) {
            return new Promise((resolve, reject) => {
              mundo.soltarLeitura.push(resolve);
              mundo.rejeitarLeitura.push(reject);
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        in: async () => ({ data: [], error: null }),
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: mundo.usuario ? { user: mundo.usuario } : null },
        }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => {
  const registrar = () => {};
  return {
    toast: Object.assign(vi.fn(registrar), {
      error: registrar,
      info: registrar,
      success: registrar,
      warning: registrar,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let atual: { isLoading: boolean };

function Sonda() {
  const { isLoading } = useCartContext();
  useEffect(() => {
    atual = { isLoading };
  }, [isLoading]);
  return null;
}

describe("CartContext — isLoading volta a valer quando a conta troca (sem recarregar)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    mundo.usuario = null;
    mundo.soltarLeitura = [];
    mundo.rejeitarLeitura = [];
    mundo.segurarLeitura = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function desenhar() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
  }

  async function esperar(ms = 80) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  it("controle: abre como visitante -> o carregando termina logo", async () => {
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(false);
  });

  it("entrou na conta sem recarregar: isLoading volta a true enquanto lê, e termina quando a leitura chega", async () => {
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(false);

    mundo.segurarLeitura = true;
    mundo.usuario = { id: "u1" };
    await desenhar();
    await esperar();
    expect(mundo.soltarLeitura).toHaveLength(1); // a leitura da conta está em voo
    expect(atual.isLoading).toBe(true);

    await act(async () => {
      mundo.soltarLeitura[0]({ data: [], error: null });
    });
    await esperar();
    expect(atual.isLoading).toBe(false);
  });

  it("a leitura da conta FALHA depois da troca: isLoading termina mesmo assim (finally)", async () => {
    await desenhar();
    await esperar();

    mundo.segurarLeitura = true;
    mundo.usuario = { id: "u1" };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(true);

    await act(async () => {
      mundo.rejeitarLeitura[0](new Error("rede caiu"));
    });
    await esperar();
    expect(atual.isLoading).toBe(false);
    erro.mockRestore();
  });

  it("troca de uma conta para outra: volta a carregar e termina com a leitura da nova", async () => {
    mundo.usuario = { id: "u1" };
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(false);

    mundo.segurarLeitura = true;
    mundo.usuario = { id: "u2" };
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(true);

    await act(async () => {
      mundo.soltarLeitura[0]({ data: [], error: null });
    });
    await esperar();
    expect(atual.isLoading).toBe(false);
  });

  it("sair da conta: não fica carregando (visitante não tem o que ler)", async () => {
    mundo.usuario = { id: "u1" };
    await desenhar();
    await esperar();

    mundo.usuario = null;
    await desenhar();
    await esperar();

    expect(atual.isLoading).toBe(false);
  });

  it("a leitura da conta que SAIU chega atrasada: não destrava a conta de agora", async () => {
    mundo.segurarLeitura = true;
    mundo.usuario = { id: "u1" };
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(true);

    mundo.usuario = { id: "u2" };
    await desenhar();
    await esperar();
    expect(atual.isLoading).toBe(true);
    expect(mundo.soltarLeitura).toHaveLength(2);

    // A leitura velha (u1) chega primeiro: a tela da u2 segue carregando.
    await act(async () => {
      mundo.soltarLeitura[0]({ data: [], error: null });
    });
    await esperar();
    expect(atual.isLoading).toBe(true);

    await act(async () => {
      mundo.soltarLeitura[1]({ data: [], error: null });
    });
    await esperar();
    expect(atual.isLoading).toBe(false);
  });
});
