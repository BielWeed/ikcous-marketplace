// @vitest-environment jsdom
//
// Carrinho salvo da conta que NÃO foi lido (cliente com conta, aparelho novo).
//
// DEFEITO MEDIDO: a leitura de `cart_items` falha (ou passa de 8 s) e o
// `isLoading` destrava de propósito (o carrinho local segue funcionando). Mas a
// tela só sabia "não está carregando e a lista está vazia" e dizia "Seu carrinho
// está vazio" -- a cliente achava que tinha perdido o carrinho. Os dados NÃO se
// perdem (a gravação fica travada em `remotoMesclado`); a frase é que era falsa.
//
// O contexto agora expõe `carrinhoSalvoNaoLido`: tem conta, a leitura inicial
// ainda não foi mesclada e o carregamento já destravou. E `relerCarrinhoSalvo`,
// a releitura que o botão "Tentar de novo" chama.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  falhaNoCarrinho: "nenhuma" as
    | "nenhuma"
    | "erro-do-banco"
    | "rede-caiu"
    | "pendurada",
  leiturasDoCarrinho: 0,
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
          if (tabela === "cart_items") {
            mundo.leiturasDoCarrinho += 1;
            if (mundo.falhaNoCarrinho === "rede-caiu") {
              return Promise.reject(new Error("rede caiu"));
            }
            if (mundo.falhaNoCarrinho === "pendurada") {
              return new Promise(() => {});
            }
            if (mundo.falhaNoCarrinho === "erro-do-banco") {
              return Promise.resolve({
                data: null,
                error: { message: "permissão negada" },
              });
            }
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

type Mundo = {
  isLoading: boolean;
  carrinhoSalvoNaoLido: boolean | undefined;
  relerCarrinhoSalvo: (() => Promise<void>) | undefined;
};
let atual: Mundo;
// O valor do sinal em CADA render (não só o último): um quadro de aviso falso
// durante uma leitura normal já é o defeito.
let sinalPorRender: Array<{ isLoading: boolean; sinal: boolean | undefined }>;

function Sonda() {
  const ctx = useCartContext();
  sinalPorRender.push({
    isLoading: ctx.isLoading,
    sinal: ctx.carrinhoSalvoNaoLido,
  });
  useEffect(() => {
    atual = {
      isLoading: ctx.isLoading,
      carrinhoSalvoNaoLido: ctx.carrinhoSalvoNaoLido,
      relerCarrinhoSalvo: ctx.relerCarrinhoSalvo,
    };
  });
  return null;
}

describe("CartContext — carrinhoSalvoNaoLido", () => {
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
    mundo.usuario = { id: "u1" };
    mundo.falhaNoCarrinho = "nenhuma";
    mundo.leiturasDoCarrinho = 0;
    sinalPorRender = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
  }

  function silenciarErros() {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it("controle: leitura boa com carrinho vazio na conta -> sem aviso", async () => {
    await montar();
    expect(atual.isLoading).toBe(false);
    expect(atual.carrinhoSalvoNaoLido).toBe(false);
  });

  it("o banco responde erro na leitura: o carregamento destrava E o aviso liga", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    silenciarErros();
    await montar();
    expect(atual.isLoading).toBe(false);
    expect(atual.carrinhoSalvoNaoLido).toBe(true);
  });

  it("a rede cai na leitura: o aviso liga", async () => {
    mundo.falhaNoCarrinho = "rede-caiu";
    silenciarErros();
    await montar();
    expect(atual.carrinhoSalvoNaoLido).toBe(true);
  });

  it("leitura pendurada passa de 8 s: o carregamento destrava E o aviso liga", async () => {
    mundo.falhaNoCarrinho = "pendurada";
    silenciarErros();
    vi.useFakeTimers();
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    // Antes do tempo-limite: ainda lendo, nada de aviso.
    expect(atual.isLoading).toBe(true);
    expect(atual.carrinhoSalvoNaoLido).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    expect(atual.isLoading).toBe(false);
    expect(atual.carrinhoSalvoNaoLido).toBe(true);
  });

  it("falhou e a releitura (botão 'Tentar de novo') dá certo: o aviso cai sozinho", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    silenciarErros();
    await montar();
    expect(atual.carrinhoSalvoNaoLido).toBe(true);

    mundo.falhaNoCarrinho = "nenhuma";
    await act(async () => {
      await atual.relerCarrinhoSalvo?.();
    });
    expect(atual.carrinhoSalvoNaoLido).toBe(false);
  });

  it("falhou e a releitura falha de novo: o aviso continua (não vira 'vazio')", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    silenciarErros();
    await montar();
    const antes = mundo.leiturasDoCarrinho;

    await act(async () => {
      await atual.relerCarrinhoSalvo?.();
    });
    expect(mundo.leiturasDoCarrinho).toBeGreaterThan(antes);
    expect(atual.carrinhoSalvoNaoLido).toBe(true);
  });

  it("convidado (sem conta): nunca há carrinho salvo a ler -> sem aviso", async () => {
    mundo.usuario = null;
    mundo.falhaNoCarrinho = "erro-do-banco";
    await montar();
    expect(atual.isLoading).toBe(false);
    expect(atual.carrinhoSalvoNaoLido).toBe(false);
    expect(mundo.leiturasDoCarrinho).toBe(0);
  });

  it("entrar na conta (convidado -> conta) com leitura normal: o aviso não pisca em nenhum quadro", async () => {
    mundo.usuario = null;
    await montar();
    expect(atual.carrinhoSalvoNaoLido).toBe(false);

    sinalPorRender = [];
    mundo.usuario = { id: "u1" };
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(mundo.leiturasDoCarrinho).toBeGreaterThan(0);
    expect(sinalPorRender.length).toBeGreaterThan(0);
    expect(sinalPorRender.some((q) => q.sinal === true)).toBe(false);
    expect(atual.isLoading).toBe(false);
    expect(atual.carrinhoSalvoNaoLido).toBe(false);
  });
});
