// @vitest-environment jsdom
//
// Onda 126, carrinho, achado 1: a LÁPIDE ("esta linha foi tirada às T") é
// comparada por relógio com o carimbo da linha. Aparelho que estava com a hora
// adiantada (e foi corrigida) guarda lápide com T NO FUTURO; a cliente põe o
// produto de novo (carimbo = agora, MENOR que a lápide) e, na primeira releitura
// (internet que volta), a junção o tratava como "tirado" e ele sumia do
// carrinho e, pela gravação seguinte, da conta salva.
//
// A regra: pôr de novo de verdade (addToCart que entrou, updateQuantity com
// quantidade > 0) apaga a lápide DA MESMA chave. Não apaga a de outra chave, nem
// quando nada entrou (produto esgotado).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { chaveDaVariacao } from "@/lib/escolhas-do-item";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const AZUL = "vc-azul";
const P = "vt-p";
const produtos = [
  { id: "p1", nome: "Camiseta", preco_venda: 10, estoque: 20 },
  { id: "p2", nome: "Bermuda", preco_venda: 30, estoque: 20 },
  { id: "p3", nome: "Boné", preco_venda: 20, estoque: 20 },
  { id: "p4", nome: "Meia", preco_venda: 5, estoque: 0 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));
// p1 é o produto antigo de duas escolhas separadas (cor + tamanho).
const variantes = [
  { id: AZUL, name: "Cor", value: "Azul", stock_increment: 5 },
  { id: P, name: "Tamanho", value: "P", stock_increment: 4 },
].map((v) => ({ ...v, product_id: "p1", price_override: null, active: true }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens.slice(), error: null }),
        in: async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? {
                data: variantes.filter((v) => ids.includes(v.product_id)),
                error: null,
              }
            : { data: produtos.filter((p) => ids.includes(p.id)), error: null },
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LAPIDES = "marketplace_cart_tombstones_v1";
const HORA = 3_600_000;
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: variantes.filter((v) => v.product_id === id),
  });
const AZUL_P = chaveDaVariacao(AZUL, [P]);

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return <output>{contexto.cartTotal}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  // O banco de verdade: a gravação SUBSTITUI o carrinho salvo (com o carimbo
  // que o aparelho mandou), e a releitura devolve o que foi gravado.
  mundo.rpc.mockImplementation(
    async (
      _nome: string,
      args: {
        p_cart_items: {
          product_id: string;
          variant_id: string;
          quantity: number;
          updated_at: string;
        }[];
      },
    ) => {
      mundo.itens = args.p_cart_items.map((i) => ({ ...i }));
      return { error: null };
    },
  );
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
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
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
async function montar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
}
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
// A internet volta: a releitura do banco que a junção processa.
async function internetVolta() {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50);
  });
}
const semearLapide = (key: string, deletedAt: number) => {
  const outras = JSON.parse(localStorage.getItem(LAPIDES) ?? "[]");
  localStorage.setItem(
    LAPIDES,
    JSON.stringify([...outras, { key, deletedAt }]),
  );
};
const chavesDasLapides = (): string[] =>
  JSON.parse(localStorage.getItem(LAPIDES) ?? "[]").map(
    (t: { key: string }) => t.key,
  );
const linhasGravadasNaUltimaChamada = (): string[] => {
  const ultima = mundo.rpc.mock.calls.at(-1);
  return (ultima?.[1].p_cart_items ?? []).map(
    (i: { product_id: string; variant_id: string }) =>
      `${i.product_id}-${i.variant_id}`,
  );
};
const linhasDoCarrinho = () =>
  atual.cart.map((i) => `${i.product.id}-${i.variantId ?? ""}`);

describe("carrinho: pôr de novo apaga a lápide da própria linha", () => {
  it("hora do aparelho voltou atrás: o produto posto de novo fica depois da releitura e vai à conta", async () => {
    semearLapide("p2-", Date.now() + HORA);
    await montar();

    await act(async () => {
      expect(atual.addToCart(produto("p2"), 1)).toBe(1);
    });
    await sincronizar();
    expect(linhasGravadasNaUltimaChamada()).toEqual(["p2-"]);

    // O banco devolve a linha com o carimbo do aparelho (menor que a lápide
    // antiga). Antes a junção a escondia e a gravação seguinte a apagava da conta.
    await internetVolta();
    expect(linhasDoCarrinho()).toEqual(["p2-"]);
    await sincronizar();
    expect(mundo.itens.map((i) => i.product_id)).toEqual(["p2"]);
    expect(chavesDasLapides()).toEqual([]);
  });

  it("a internet volta ANTES de a gravação sair (edição pendente, banco vazio): a linha fica e é enviada", async () => {
    semearLapide("p2-", Date.now() + HORA);
    await montar();

    await act(async () => {
      atual.addToCart(produto("p2"), 1);
    });
    await internetVolta();
    expect(linhasDoCarrinho()).toEqual(["p2-"]);

    await sincronizar();
    expect(linhasGravadasNaUltimaChamada()).toEqual(["p2-"]);
  });

  it("produto de duas escolhas: a lápide da MESMA combinação sai, e só ela", async () => {
    semearLapide(`p1-${AZUL_P}`, Date.now() + HORA);
    semearLapide("p1-", Date.now() + HORA);
    semearLapide("p3-", Date.now() + HORA);
    await montar();

    await act(async () => {
      expect(
        atual.addToCart(produto("p1"), 1, AZUL_P, "Cor: Azul, Tamanho: P"),
      ).toBe(1);
    });
    await internetVolta();
    await sincronizar();

    expect(linhasDoCarrinho()).toEqual([`p1-${AZUL}`]);
    expect(linhasGravadasNaUltimaChamada()).toEqual([`p1-${AZUL_P}`]);
    // As lápides de OUTRAS chaves (inclusive a do mesmo produto sem escolha)
    // seguem valendo: tirar o que a cliente tirou de verdade não pode voltar.
    expect(chavesDasLapides().sort()).toEqual(["p1-", "p3-"]);
  });

  it("somar a quantidade de uma linha que já está no carrinho também apaga a lápide dela", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto("p2"), 1);
    });
    // Outra aba tirou o p2 com a hora adiantada e a lápide chegou aqui.
    semearLapide("p2-", Date.now() + HORA);

    await act(async () => {
      expect(atual.addToCart(produto("p2"), 2)).toBe(2);
    });
    expect(chavesDasLapides()).toEqual([]);
    await internetVolta();
    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p2", 3],
    ]);
  });

  it("nada entrou (produto esgotado): a lápide fica, porque a cliente não pôs nada de novo", async () => {
    semearLapide("p4-", Date.now() + HORA);
    await montar();

    await act(async () => {
      expect(atual.addToCart(produto("p4"), 1)).toBe(0);
    });

    expect(atual.cart).toEqual([]);
    expect(chavesDasLapides()).toEqual(["p4-"]);
  });

  it("updateQuantity com quantidade > 0 apaga a lápide da linha; com 0 a tira de verdade e marca a lápide", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto("p2"), 1);
      atual.addToCart(produto("p3"), 1);
    });
    // Lápides que chegaram de outra aba (hora adiantada) para as duas linhas.
    semearLapide("p2-", Date.now() + HORA);
    semearLapide("p3-", Date.now() + HORA);

    await act(async () => atual.updateQuantity("p2", 3));
    expect(chavesDasLapides()).toEqual(["p3-"]);
    await internetVolta();
    // O p3 (lápide futura, ninguém mexeu nele depois) é o que a lápide esconde;
    // o p2, que a cliente mexeu de verdade, fica com a quantidade nova.
    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toContainEqual([
      "p2",
      3,
    ]);

    // Quantidade 0 é tirar: a lápide nasce (e a linha sai).
    await act(async () => atual.updateQuantity("p2", 0));
    expect(chavesDasLapides().sort()).toEqual(["p2-", "p3-"]);
    expect(atual.cart.map((i) => i.product.id)).not.toContain("p2");
  });

  it("controle: lápide NO PASSADO continua escondendo a linha velha que o banco devolve", async () => {
    semearLapide("p2-", Date.now() - 500);
    mundo.itens = [
      {
        product_id: "p2",
        variant_id: "",
        quantity: 1,
        updated_at: new Date(Date.now() - 1000).toISOString(),
      },
      {
        product_id: "p3",
        variant_id: "",
        quantity: 1,
        updated_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    await montar();

    // p2 foi tirado aqui DEPOIS do carimbo do banco: continua tirado. p3 entra.
    expect(linhasDoCarrinho()).toEqual(["p3-"]);
    expect(chavesDasLapides()).toEqual(["p2-"]);
  });
});
