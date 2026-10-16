// @vitest-environment jsdom
//
// PERDA DE DADO medida (16/10/2026): a cliente tem produtos salvos na conta,
// adiciona outro como CONVIDADA e entra. Se a leitura do carrinho salvo (a
// tabela `cart_items`) FALHA (ex.: 503), o app destravava a gravação mesmo sem
// ter lido nem mesclado o carrinho do banco. Ao mexer na quantidade de um item,
// a gravação mandava SÓ os itens do convidado para `sync_cart_atomic` — que
// apaga tudo o que está no banco antes de gravar — e os produtos salvos na
// conta sumiam, sem releitura.
//
// Regra travada aqui: enquanto o estado do banco é DESCONHECIDO (a leitura
// inicial não teve sucesso e não foi mesclada), nada é gravado no servidor. O
// carrinho local segue funcionando; a leitura é refeita (espera crescente com
// teto, evento `online`, app visível, próxima edição) e só DEPOIS da junção a
// gravação leva a união.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
type Leitura = "ok" | "falha" | "pendurada";

const T = 1_760_000_000_000;

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  leitura: "ok" as "ok" | "falha" | "pendurada",
  itensNoBanco: [] as Array<Record<string, unknown>>,
  catalogo: [] as Array<Record<string, unknown>>,
  falhaNoCatalogo: false,
  leiturasDoCarrinho: 0,
  soltarLeitura: null as null | (() => void),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/catalogo-do-carrinho", () => ({
  montarCatalogo: () => ({}),
  aplicarCatalogoAoCarrinho: (itens: unknown[]) => itens,
  avisosDoCarrinho: async () => [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => {
          mundo.leiturasDoCarrinho += 1;
          if (mundo.leitura === "pendurada") {
            await new Promise<void>((r) => {
              mundo.soltarLeitura = r;
            });
            return { data: mundo.itensNoBanco, error: null };
          }
          if (mundo.leitura === "falha") {
            return { data: null, error: { message: "503" } };
          }
          return { data: mundo.itensNoBanco, error: null };
        },
        in: async () => {
          if (tabela === "vw_produtos_public") {
            if (mundo.falhaNoCatalogo) {
              return { data: null, error: { message: "503" } };
            }
            return { data: mundo.catalogo, error: null };
          }
          return { data: [], error: null };
        },
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: mundo.usuario ? { user: mundo.usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SALVO = "prod-salvo-na-conta";
const DO_CONVIDADO = "prod-do-convidado";
const OUTRO = "prod-outro";

function produto(id: string): Product {
  return {
    id,
    name: id,
    price: 10,
    images: [],
    stock: 10,
  } as unknown as Product;
}
function linhaDoCatalogo(id: string): Linha {
  return {
    id,
    nome: id,
    preco_venda: 10,
    estoque: 10,
    ativo: true,
    imagens: [],
    categoria: "geral",
  };
}
function linhaDoBanco(productId: string, quantity: number): Linha {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(T).toISOString(),
  };
}

const observar = vi.fn();
function Sonda() {
  observar(useCartContext());
  return null;
}
const atual = () =>
  observar.mock.calls.at(-1)![0] as ReturnType<typeof useCartContext>;
const quantidades = () =>
  Object.fromEntries(atual().cart.map((i) => [i.product.id, i.quantity]));

/** O que a última gravação mandou ao banco: produto -> quantidade. */
function ultimaGravacao(): Record<string, number> {
  const chamada = mundo.rpc.mock.calls.at(-1);
  expect(chamada).toBeDefined();
  expect(chamada![0]).toBe("sync_cart_atomic");
  const itens = (chamada![1] as { p_cart_items: Linha[] }).p_cart_items;
  return Object.fromEntries(
    itens.map((i) => [i.product_id as string, i.quantity as number]),
  );
}

describe("CartContext — leitura do carrinho salvo falha: nada é gravado por cima", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const leitura = (l: Leitura) => {
    mundo.leitura = l;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mundo.usuario = null;
    mundo.leitura = "ok";
    mundo.itensNoBanco = [linhaDoBanco(SALVO, 2)];
    mundo.catalogo = [linhaDoCatalogo(SALVO)];
    mundo.falhaNoCatalogo = false;
    mundo.leiturasDoCarrinho = 0;
    mundo.soltarLeitura = null;
    mundo.rpc.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const valores = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => valores.get(k) ?? null,
      setItem: (k: string, v: string) => void valores.set(k, v),
      removeItem: (k: string) => void valores.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
  // Em passos curtos: o `act` só aplica o estado do React (o que reabre os
  // efeitos de gravação) quando ele termina.
  async function avancar(ms: number) {
    for (let t = 0; t < ms; t += 500) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(500, ms - t));
      });
    }
  }
  /** Convidada com um produto no carrinho que entra na conta (id "A"). */
  async function convidadaQueEntra() {
    await desenhar();
    await act(async () => atual().addToCart(produto(DO_CONVIDADO)));
    await avancar(1500);
    expect(mundo.rpc).not.toHaveBeenCalled();
    mundo.usuario = { id: "A" };
    await desenhar();
    await avancar(100);
  }
  const mudarQuantidade = (id: string, quantidade: number) =>
    act(async () => atual().updateQuantity(id, quantidade));
  const ficarOnline = () =>
    act(async () => {
      window.dispatchEvent(new Event("online"));
    });

  describe("a sequência do defeito", () => {
    it("leitura falha + alterar a quantidade: NENHUMA gravação no servidor, o carrinho local segue vivo", async () => {
      leitura("falha");
      await convidadaQueEntra();
      expect(mundo.leiturasDoCarrinho).toBeGreaterThanOrEqual(1);

      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(1500);

      expect(mundo.rpc).not.toHaveBeenCalled();
      // Na tela o carrinho funciona normalmente.
      expect(quantidades()).toEqual({ [DO_CONVIDADO]: 3 });
      expect(atual().isLoading).toBe(false);
      // E segue guardado no aparelho.
      expect(
        JSON.parse(localStorage.getItem("marketplace_cart_v1") ?? "[]")[0]
          .quantity,
      ).toBe(3);
    });

    it("segue sem gravar por minutos (esperas crescentes com teto) enquanto a leitura continua falhando", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(10 * 60_000);

      expect(mundo.rpc).not.toHaveBeenCalled();
      const leituras = mundo.leiturasDoCarrinho;
      expect(leituras).toBeGreaterThan(1);
      expect(leituras).toBeLessThanOrEqual(8);
      // Não vira laço: passado o teto, ninguém mais insiste sozinho.
      await avancar(10 * 60_000);
      expect(mundo.leiturasDoCarrinho).toBe(leituras);
      expect(mundo.rpc).not.toHaveBeenCalled();
    });

    it("volta a internet (evento online): relê, mescla e SÓ ENTÃO grava a união", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(1500);
      expect(mundo.rpc).not.toHaveBeenCalled();

      leitura("ok");
      await ficarOnline();
      await avancar(1500);

      expect(quantidades()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
    });

    it("edição e releitura bem-sucedida na mesma janela de 1 s: nenhuma gravação leva só o que era do convidado", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      // A leitura volta antes de o temporizador da edição disparar.
      leitura("ok");
      await ficarOnline();
      await avancar(3000);

      expect(mundo.rpc).toHaveBeenCalled();
      for (const chamada of mundo.rpc.mock.calls) {
        const itens = (chamada[1] as { p_cart_items: Linha[] }).p_cart_items;
        expect(itens.map((i) => i.product_id).sort()).toEqual(
          [DO_CONVIDADO, SALVO].sort(),
        );
      }
    });

    it("a espera crescente refaz a leitura sozinha: depois do sucesso, a gravação leva a união", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(1500);
      expect(mundo.rpc).not.toHaveBeenCalled();

      leitura("ok");
      await avancar(40_000);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
    });

    it("o app volta a ficar visível: relê e mescla antes de gravar", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(10 * 60_000); // esgota as esperas
      expect(mundo.rpc).not.toHaveBeenCalled();

      leitura("ok");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await avancar(1500);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
    });

    it("a próxima edição da cliente refaz a leitura (esgotadas as esperas) e a gravação leva a união", async () => {
      leitura("falha");
      await convidadaQueEntra();
      await avancar(10 * 60_000);
      expect(mundo.rpc).not.toHaveBeenCalled();

      leitura("ok");
      await mudarQuantidade(DO_CONVIDADO, 4);
      // 1 s até a edição reler + 1 s até a junção gravar.
      await avancar(2600);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 4, [SALVO]: 2 });
    });

    it("a leitura do catálogo falha depois da do carrinho: o carrinho do banco continua desconhecido, nada é gravado", async () => {
      mundo.falhaNoCatalogo = true;
      await convidadaQueEntra();
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(1500);
      expect(mundo.rpc).not.toHaveBeenCalled();

      mundo.falhaNoCatalogo = false;
      await ficarOnline();
      await avancar(1500);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
    });

    it("leitura lenta (passa dos 8 s que destravam a tela): a tela destrava, mas nada é gravado até a leitura chegar", async () => {
      leitura("pendurada");
      await convidadaQueEntra();
      await avancar(9000);
      expect(atual().isLoading).toBe(false);

      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(3000);
      expect(mundo.rpc).not.toHaveBeenCalled();

      await act(async () => {
        mundo.soltarLeitura?.();
      });
      await avancar(1500);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 3, [SALVO]: 2 });
    });
  });

  describe("o que já funcionava continua sincronizando", () => {
    it("entrada normal com carrinho salvo e carrinho de convidado: junta os dois e grava a união", async () => {
      await convidadaQueEntra();
      await avancar(1500);

      expect(quantidades()).toEqual({ [DO_CONVIDADO]: 1, [SALVO]: 2 });
      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 1, [SALVO]: 2 });

      await mudarQuantidade(DO_CONVIDADO, 5);
      await avancar(1500);
      expect(mundo.rpc).toHaveBeenCalledTimes(2);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 5, [SALVO]: 2 });
    });

    it("carrinho salvo VAZIO e convidada com itens: a gravação leva o que ela tem", async () => {
      mundo.itensNoBanco = [];
      await convidadaQueEntra();
      await avancar(1500);

      expect(mundo.rpc).toHaveBeenCalledTimes(1);
      expect(ultimaGravacao()).toEqual({ [DO_CONVIDADO]: 1 });
    });

    it("entrada sem nada no aparelho: adota o carrinho salvo e a próxima edição grava com ele", async () => {
      mundo.usuario = { id: "A" };
      await desenhar();
      await avancar(1500);
      expect(quantidades()).toEqual({ [SALVO]: 2 });

      mundo.rpc.mockClear();
      await act(async () => atual().addToCart(produto(OUTRO)));
      await avancar(1500);
      expect(ultimaGravacao()).toEqual({ [SALVO]: 2, [OUTRO]: 1 });
    });

    it("convidada sem conta: não lê nem grava nada no banco, o carrinho funciona", async () => {
      await desenhar();
      await act(async () => atual().addToCart(produto(DO_CONVIDADO)));
      await mudarQuantidade(DO_CONVIDADO, 3);
      await avancar(5000);

      expect(quantidades()).toEqual({ [DO_CONVIDADO]: 3 });
      expect(mundo.leiturasDoCarrinho).toBe(0);
      expect(mundo.rpc).not.toHaveBeenCalled();
    });
  });

  describe("troca de conta", () => {
    it("a conta A leu e mesclou; a conta B tem a leitura falhando: a liberação de A não vale para B", async () => {
      mundo.usuario = { id: "A" };
      await desenhar();
      await avancar(1500);
      mundo.rpc.mockClear();

      leitura("falha");
      mundo.usuario = { id: "B" };
      await desenhar();
      await avancar(100);
      await act(async () => atual().addToCart(produto(OUTRO)));
      await avancar(1500);

      expect(quantidades()).toEqual({ [OUTRO]: 1 });
      expect(mundo.rpc).not.toHaveBeenCalled();
    });
  });
});
