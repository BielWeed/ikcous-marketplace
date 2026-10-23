// @vitest-environment jsdom
//
// Defeito carrinho-checkout-1: produto de cadastro ANTIGO com duas escolhas
// separadas (linhas "Cor: Azul" e "Tamanho: P" em product_variants, nunca a
// linha "Azul + P"). O carrinho guardava o id da PRIMEIRA escolha só, e a
// identidade da linha era produto + esse id: "Azul-P" e "Azul-M" caíam na mesma
// linha (quantidade 2, nome do primeiro) e o pedido saía com a escolha errada.
//
// O que este arquivo prova: cada combinação é uma linha própria, com as DUAS
// escolhas guardadas (memória, aparelho e banco), estoque conferido pela
// combinação, o dinheiro continua lido do primeiro id (o que o servidor cobra),
// e o formato antigo (uma escolha, ou nenhuma) segue idêntico.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import {
  aplicarCatalogoAoCarrinho,
  montarCatalogo,
} from "@/lib/catalogo-do-carrinho";
import {
  assinaturaDosItens,
  chaveDaVariacao,
  chaveDoItem,
  estoqueDaLinha,
  normalizarChave,
  notaDasEscolhas,
  ordenarPelaGrade,
  precoDaEscolha,
  separarChave,
} from "@/lib/escolhas-do-item";
import { mapProductFromDB } from "@/lib/mappers";
import type { CartItem } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  erro: vi.fn(),
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
  toast: { error: mundo.erro, info: vi.fn(), warning: vi.fn() },
}));

const AZUL = "vc-azul";
const ROSA = "vc-rosa";
const P = "vt-p";
const M = "vt-m";
const linha = {
  id: "p1",
  nome: "Camiseta",
  preco_venda: 10,
  estoque: 20,
  ativo: true,
  imagens: [],
};
const variantes = [
  { id: AZUL, name: "Cor", value: "Azul", stock_increment: 5 },
  { id: ROSA, name: "Cor", value: "Rosa", stock_increment: 5 },
  { id: P, name: "Tamanho", value: "P", stock_increment: 4 },
  { id: M, name: "Tamanho", value: "M", stock_increment: 2 },
].map((v) => ({ ...v, product_id: "p1", price_override: null, active: true }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens, error: null }),
        in: async () =>
          tabela === "product_variants"
            ? { data: variantes, error: null }
            : { data: [linha], error: null },
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = () =>
  mapProductFromDB({ ...linha, product_variants: variantes });
const AZUL_P = chaveDaVariacao(AZUL, [P]);
const AZUL_M = chaveDaVariacao(AZUL, [M]);
const NOME_AZUL_P = "Cor: Azul, Tamanho: P";
const NOME_AZUL_M = "Cor: Azul, Tamanho: M";

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
  mundo.rpc.mockResolvedValue({ error: null });
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
  // O carrinho grava no aparelho: nada pode sobrar para o teste seguinte.
  // Limpa ANTES de devolver os globais.
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
const resumo = (cart: CartItem[]) =>
  cart.map((i) => [i.variantId, i.outrasVariantIds, i.quantity]);

describe("carrinho: produto com cor e tamanho em escolhas separadas", () => {
  it("Azul-P e Azul-M viram duas linhas, cada uma com as duas escolhas", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
      atual.addToCart(produto(), 1, AZUL_M, NOME_AZUL_M);
    });
    expect(atual.cart).toHaveLength(2);
    expect(resumo(atual.cart)).toEqual([
      [AZUL, [P], 1],
      [AZUL, [M], 1],
    ]);
    expect(atual.cart.map((i) => i.variantNames)).toEqual([
      NOME_AZUL_P,
      NOME_AZUL_M,
    ]);
    expect(atual.cartCount).toBe(2);
    expect(atual.cartTotal).toBe(20);
  });

  it("a mesma combinação soma a quantidade na mesma linha", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
      atual.addToCart(produto(), 2, AZUL_P, NOME_AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([[AZUL, [P], 3]]);
  });

  it("o estoque é conferido pela combinação: vale o menor entre cor e tamanho", async () => {
    await montar();
    await act(async () => {
      // Azul tem 5 e M tem 2: levar Azul-M só é possível até 2.
      atual.addToCart(produto(), 5, AZUL_M, NOME_AZUL_M);
    });
    expect(atual.cart[0].quantity).toBe(2);
    expect(mundo.erro).toHaveBeenCalledWith("Apenas 2 unidades disponíveis.");
    await act(async () => {
      atual.updateQuantity("p1", 4, AZUL_M);
    });
    expect(atual.cart[0].quantity).toBe(2);
    // Azul-P não herda o limite do M (P tem 4)... mas o servidor baixa as duas
    // linhas contra o MESMO azul (5 peças): com 2 já levadas em Azul-M, só
    // sobram 3 para Azul-P. Sem isso o pedido falharia no último clique.
    await act(async () => {
      atual.addToCart(produto(), 9, AZUL_P, NOME_AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([
      [AZUL, [M], 2],
      [AZUL, [P], 3],
    ]);
    expect(atual.cartCount).toBe(5);
    // Subir a quantidade de uma linha também respeita o que a outra leva.
    await act(async () => {
      atual.updateQuantity("p1", 4, AZUL_P);
    });
    expect(atual.cart[1].quantity).toBe(3);
    // A linha de Azul-M já no teto do M; tirar Azul-P libera o azul de novo.
    await act(async () => {
      atual.removeFromCart("p1", AZUL_M);
    });
    await act(async () => {
      atual.updateQuantity("p1", 4, AZUL_P);
    });
    expect(atual.cart[0].quantity).toBe(4);
  });

  it("a cor sozinha (linha antiga) e a combinação dividem o mesmo estoque da cor", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 4, AZUL, "Cor: Azul");
      atual.addToCart(produto(), 3, AZUL_P, NOME_AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([
      [AZUL, undefined, 4],
      [AZUL, [P], 1],
    ]);
  });

  it("combinação esgotada (tamanho zerado) não entra, mesmo com cor em estoque", async () => {
    const semM = mapProductFromDB({
      ...linha,
      product_variants: variantes.map((v) =>
        v.id === M ? { ...v, stock_increment: 0 } : v,
      ),
    });
    await montar();
    await act(async () => {
      atual.addToCart(semM, 1, AZUL_M, NOME_AZUL_M);
    });
    expect(atual.cart).toEqual([]);
    expect(mundo.erro).toHaveBeenCalledWith("Este produto está esgotado.");
  });

  it("tirar ou mudar uma combinação não mexe na outra", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
      atual.addToCart(produto(), 1, AZUL_M, NOME_AZUL_M);
    });
    await act(async () => {
      atual.updateQuantity("p1", 3, AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([
      [AZUL, [P], 3],
      [AZUL, [M], 1],
    ]);
    await act(async () => {
      atual.removeFromCart("p1", AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([[AZUL, [M], 1]]);
    // A exclusão fica marcada pela combinação: a outra não é "ressuscitada"
    // nem "apagada" pelo merge das abas.
    const marcas = JSON.parse(
      localStorage.getItem("marketplace_cart_tombstones_v1") ?? "[]",
    ).map((t: { key: string }) => t.key);
    expect(marcas).toEqual([`p1-${AZUL_P}`]);
  });

  it("limpar o carrinho marca cada combinação separadamente", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
      atual.addToCart(produto(), 1, AZUL_M, NOME_AZUL_M);
    });
    await act(async () => atual.clearCart());
    const marcas = JSON.parse(
      localStorage.getItem("marketplace_cart_tombstones_v1") ?? "[]",
    ).map((t: { key: string }) => t.key);
    expect(marcas.sort()).toEqual([`p1-${AZUL_M}`, `p1-${AZUL_P}`].sort());
  });

  it("o dinheiro segue lido do primeiro id (o que o servidor cobra)", async () => {
    const comPreco = mapProductFromDB({
      ...linha,
      product_variants: variantes.map((v) =>
        v.id === AZUL
          ? { ...v, price_override: 12 }
          : v.id === P
            ? { ...v, price_override: 99 }
            : v,
      ),
    });
    await montar();
    await act(async () => {
      atual.addToCart(comPreco, 2, AZUL_P, NOME_AZUL_P);
    });
    // 12 (override do Azul) x 2 -- o override do P (99) nunca entrou na conta
    // antes e continua sem entrar: o pedido só leva o primeiro id.
    expect(atual.cartTotal).toBe(24);
  });

  it("o banco recebe uma linha por combinação, com as duas escolhas no texto", async () => {
    await montar();
    await act(async () => {
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
      atual.addToCart(produto(), 2, AZUL_M, NOME_AZUL_M);
    });
    await sincronizar();
    expect(mundo.rpc.mock.calls.at(-1)?.[1].p_cart_items).toEqual([
      expect.objectContaining({
        product_id: "p1",
        variant_id: AZUL_P,
        quantity: 1,
        variant_names: NOME_AZUL_P,
      }),
      expect.objectContaining({
        product_id: "p1",
        variant_id: AZUL_M,
        quantity: 2,
        variant_names: NOME_AZUL_M,
      }),
    ]);
  });

  it("o carrinho do banco com duas combinações volta como duas linhas", async () => {
    const quando = new Date(Date.now() - 1000).toISOString();
    mundo.itens = [
      {
        product_id: "p1",
        variant_id: AZUL_P,
        quantity: 1,
        variant_names: NOME_AZUL_P,
        updated_at: quando,
      },
      {
        product_id: "p1",
        variant_id: AZUL_M,
        quantity: 2,
        variant_names: NOME_AZUL_M,
        updated_at: quando,
      },
      // Linha de antes da correção (uma escolha só) convive com as novas.
      { product_id: "p1", variant_id: P, quantity: 1, updated_at: quando },
    ];
    await montar();
    expect(resumo(atual.cart)).toEqual([
      [AZUL, [P], 1],
      [AZUL, [M], 2],
      [P, undefined, 1],
    ]);
    expect(atual.cart.map((i) => i.variantNames)).toEqual([
      NOME_AZUL_P,
      NOME_AZUL_M,
      undefined,
    ]);
  });

  it("carrinho salvo no aparelho no formato antigo abre igual, e a escolha nova é outra linha", async () => {
    const antigo = {
      product: produto(),
      quantity: 2,
      variantId: AZUL,
      variantNames: "Cor: Azul",
      lastModifiedAt: Date.now(),
    };
    localStorage.setItem("marketplace_cart_v1", JSON.stringify([antigo]));
    await montar();
    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0].variantId).toBe(AZUL);
    expect(atual.cart[0].outrasVariantIds).toBeUndefined();
    expect(atual.cart[0].quantity).toBe(2);

    await act(async () => {
      // Mesma chave de sempre: soma na linha antiga...
      atual.addToCart(produto(), 1, AZUL, "Cor: Azul");
      // ...e a combinação nova é linha à parte.
      atual.addToCart(produto(), 1, AZUL_P, NOME_AZUL_P);
    });
    expect(resumo(atual.cart)).toEqual([
      [AZUL, undefined, 3],
      [AZUL, [P], 1],
    ]);
  });

  it("o formato novo salvo no aparelho sobrevive à hidratação com as duas escolhas", async () => {
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto(),
          quantity: 1,
          variantId: AZUL,
          outrasVariantIds: [P],
          variantNames: NOME_AZUL_P,
          lastModifiedAt: Date.now(),
        },
      ]),
    );
    await montar();
    expect(atual.cart[0].outrasVariantIds).toEqual([P]);
    expect(atual.cart[0].variantNames).toBe(NOME_AZUL_P);
  });

  it("produto sem escolha e produto com uma escolha seguem exatamente como antes", async () => {
    const semVariacao = mapProductFromDB(linha);
    await montar();
    await act(async () => {
      atual.addToCart(semVariacao, 1);
      atual.addToCart(produto(), 2, P, "Tamanho: P");
    });
    expect(atual.cart.map((i) => Object.keys(i).sort())).toEqual([
      ["lastModifiedAt", "product", "quantity", "variantId", "variantNames"],
      ["lastModifiedAt", "product", "quantity", "variantId", "variantNames"],
    ]);
    expect(resumo(atual.cart)).toEqual([
      [undefined, undefined, 1],
      [P, undefined, 2],
    ]);
    await sincronizar();
    expect(mundo.rpc.mock.calls.at(-1)?.[1].p_cart_items).toEqual([
      expect.objectContaining({ variant_id: "", quantity: 1 }),
      expect.objectContaining({ variant_id: P, quantity: 2 }),
    ]);
  });
});

describe("escolhas do item: chave, estoque, assinatura e observação do pedido", () => {
  it("a chave composta vai e volta; uma escolha ou nenhuma é a chave de sempre", () => {
    expect(chaveDaVariacao(AZUL, [P])).toBe(`${AZUL}~${P}`);
    expect(chaveDaVariacao(AZUL)).toBe(AZUL);
    expect(chaveDaVariacao(undefined)).toBe("");
    expect(chaveDaVariacao(null, [])).toBe("");
    expect(chaveDaVariacao("")).toBe("");
    expect(separarChave(AZUL_P)).toEqual({
      variantId: AZUL,
      outrasVariantIds: [P],
    });
    expect(separarChave(AZUL)).toEqual({
      variantId: AZUL,
      outrasVariantIds: [],
    });
    expect(separarChave("")).toEqual({
      variantId: undefined,
      outrasVariantIds: [],
    });
    expect(separarChave(null)).toEqual({
      variantId: undefined,
      outrasVariantIds: [],
    });
  });

  it("separador solto ou chave só de separadores não inventa escolha", () => {
    expect(separarChave(`~${AZUL}~`)).toEqual({
      variantId: AZUL,
      outrasVariantIds: [],
    });
    expect(separarChave("~~")).toEqual({
      variantId: undefined,
      outrasVariantIds: [],
    });
    expect(normalizarChave(`${AZUL}~~${P}`)).toBe(AZUL_P);
  });

  it("id repetido não conta duas vezes", () => {
    expect(chaveDaVariacao(AZUL, [AZUL, P, P])).toBe(AZUL_P);
    expect(separarChave(`${AZUL}~${AZUL}~${P}`)).toEqual({
      variantId: AZUL,
      outrasVariantIds: [P],
    });
  });

  it("a identidade da linha com uma escolha é a de antes (produto-variantId)", () => {
    const p = produto();
    expect(chaveDoItem({ product: p, variantId: AZUL })).toBe("p1-vc-azul");
    expect(chaveDoItem({ product: p })).toBe("p1-");
    expect(
      chaveDoItem({ product: p, variantId: AZUL, outrasVariantIds: [P] }),
    ).toBe(`p1-${AZUL_P}`);
  });

  it("a ordem é fixa: não depende da ordem dos toques nem da ordem das linhas do banco", () => {
    const todas = produto().variants ?? [];
    const por = (id: string) => todas.find((v) => v.id === id)!;
    const ids = (lista: ReturnType<typeof ordenarPelaGrade>) =>
      lista.map((v) => v.id);
    // Cor antes de Tamanho, qualquer que seja a ordem em que chegam.
    expect(ids(ordenarPelaGrade([por(P), por(AZUL)]))).toEqual([AZUL, P]);
    expect(ids(ordenarPelaGrade([por(AZUL), por(P)]))).toEqual([AZUL, P]);
    expect(ids(ordenarPelaGrade([por(P)]))).toEqual([P]);
    expect(ids(ordenarPelaGrade([]))).toEqual([]);
    // Mesmo rótulo de grupo: desempata pelo id.
    const a = { ...por(P), id: "a-id", name: "Tamanho" };
    const b = { ...por(M), id: "b-id", name: "Tamanho" };
    expect(ids(ordenarPelaGrade([b, a]))).toEqual(["a-id", "b-id"]);
    // Embaralhar as variações do produto não muda chave, id principal nem preço.
    const comPreco = variantes.map((v) =>
      v.id === AZUL ? { ...v, price_override: 12 } : v,
    );
    const resultados = new Set<string>();
    for (const ordem of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2],
    ]) {
      const embaralhado = mapProductFromDB({
        ...linha,
        product_variants: ordem.map((i) => comPreco.at(i)!),
      });
      const escolhidas = ordenarPelaGrade(
        [P, AZUL].map((id) => embaralhado.variants!.find((v) => v.id === id)!),
      );
      resultados.add(
        JSON.stringify([
          chaveDaVariacao(
            escolhidas[0].id,
            escolhidas.slice(1).map((v) => v.id),
          ),
          escolhidas[0].id,
          precoDaEscolha(embaralhado, escolhidas),
        ]),
      );
    }
    expect([...resultados]).toEqual([JSON.stringify([AZUL_P, AZUL, 12])]);
  });

  it("o preço da escolha é o da variação principal, nunca o último ajuste tocado", () => {
    const comAjustes = mapProductFromDB({
      ...linha,
      product_variants: variantes.map((v) =>
        v.id === M ? { ...v, price_override: 60 } : v,
      ),
    });
    const por = (id: string) => comAjustes.variants!.find((v) => v.id === id)!;
    // Azul sem ajuste é a principal; o R$ 60 do M não é cobrado.
    expect(precoDaEscolha(comAjustes, [por(M), por(AZUL)])).toBe(10);
    expect(precoDaEscolha(comAjustes, [por(AZUL), por(M)])).toBe(10);
    // 0 e 1 escolha: como sempre.
    expect(precoDaEscolha(comAjustes, [])).toBe(10);
    expect(precoDaEscolha(comAjustes, [por(M)])).toBe(60);
    expect(precoDaEscolha(comAjustes, [por(AZUL)])).toBe(10);
  });

  it("estoque da linha: o menor entre as escolhas; variação que sumiu vale zero", () => {
    const p = produto();
    expect(estoqueDaLinha(p, AZUL, [M])).toBe(2);
    expect(estoqueDaLinha(p, AZUL, [P])).toBe(4);
    expect(estoqueDaLinha(p, AZUL)).toBe(5);
    expect(estoqueDaLinha(p, AZUL, ["sumiu"])).toBe(0);
    // Descontando o que as OUTRAS linhas já levam da mesma variação.
    const outra = (outras: string[], quantity: number): CartItem => ({
      product: p,
      quantity,
      variantId: AZUL,
      outrasVariantIds: outras,
    });
    expect(estoqueDaLinha(p, AZUL, [P], [outra([M], 2)])).toBe(3);
    expect(estoqueDaLinha(p, AZUL, [M], [outra([P], 4)])).toBe(1);
    // Linha de OUTRO produto não desconta nada.
    expect(
      estoqueDaLinha(
        p,
        AZUL,
        [P],
        [{ ...outra([M], 2), product: { ...p, id: "p2" } }],
      ),
    ).toBe(4);
    // Sem variação (ou com id desconhecido): o estoque do produto.
    expect(estoqueDaLinha(p)).toBe(p.stock);
    expect(estoqueDaLinha(p, "id-que-nao-existe")).toBe(p.stock);
  });

  it("a assinatura de idempotência separa Azul-P de Azul-M (senão a retentativa devolve o pedido da outra)", () => {
    const base = { product: produto(), quantity: 1, variantId: AZUL };
    const azulP: CartItem = { ...base, outrasVariantIds: [P] };
    const azulM: CartItem = { ...base, outrasVariantIds: [M] };
    expect(assinaturaDosItens([azulP])).not.toBe(assinaturaDosItens([azulM]));
    // Sem a segunda escolha continua a de antes: [produto, variantId, qtd].
    expect(assinaturaDosItens([base])).toBe(JSON.stringify(["p1", AZUL, 1]));
    // Ordem das linhas não muda a assinatura.
    expect(assinaturaDosItens([azulP, azulM])).toBe(
      assinaturaDosItens([azulM, azulP]),
    );
  });

  it("o pedido leva as duas escolhas por escrito, cada linha com a sua quantidade", () => {
    const base = { product: produto() };
    const itens: CartItem[] = [
      {
        ...base,
        quantity: 1,
        variantId: AZUL,
        outrasVariantIds: [P],
        variantNames: NOME_AZUL_P,
      },
      {
        ...base,
        quantity: 2,
        variantId: AZUL,
        outrasVariantIds: [M],
        variantNames: NOME_AZUL_M,
      },
      // Linha de uma escolha: texto idêntico ao de antes, sem quantidade.
      { ...base, quantity: 3, variantId: ROSA, variantNames: "Cor: Rosa" },
      // Sem variação: não aparece.
      { ...base, quantity: 1 },
    ];
    expect(notaDasEscolhas(itens)).toBe(
      [
        `Camiseta: ${NOME_AZUL_P} (1 un.)`,
        `Camiseta: ${NOME_AZUL_M} (2 un.)`,
        "Camiseta: Cor: Rosa",
      ].join("\n"),
    );
    expect(notaDasEscolhas([])).toBe("");
  });

  it("o catálogo relido confere a combinação: tamanho que zerou tira a linha, estoque baixo corta", () => {
    const hoje = (alteracao: (v: (typeof variantes)[number]) => unknown) =>
      montarCatalogo(
        ["p1"],
        [linha],
        variantes.map((v) => alteracao(v) as Record<string, unknown>),
      );
    const item = (outras: string[], quantity: number): CartItem => ({
      product: produto(),
      quantity,
      variantId: AZUL,
      outrasVariantIds: outras,
    });

    // M zerou: Azul-M sai, Azul-P (com estoque) fica.
    const semM = hoje((v) => (v.id === M ? { ...v, stock_increment: 0 } : v));
    expect(
      aplicarCatalogoAoCarrinho([item([M], 1), item([P], 1)], semM).map(
        (i) => i.outrasVariantIds,
      ),
    ).toEqual([[P]]);

    // M caiu para 1: a linha de 2 desce para 1.
    const poucoM = hoje((v) => (v.id === M ? { ...v, stock_increment: 1 } : v));
    expect(
      aplicarCatalogoAoCarrinho([item([M], 2)], poucoM).map((i) => i.quantity),
    ).toEqual([1]);

    // Tamanho desativado ou apagado: a linha não é mais vendável.
    const mDesativado = hoje((v) => (v.id === M ? { ...v, active: false } : v));
    expect(aplicarCatalogoAoCarrinho([item([M], 1)], mDesativado)).toEqual([]);
    const semMNoBanco = montarCatalogo(
      ["p1"],
      [linha],
      variantes.filter((v) => v.id !== M),
    );
    expect(aplicarCatalogoAoCarrinho([item([M], 1)], semMNoBanco)).toEqual([]);

    // As linhas dividem o MESMO azul (5): a releitura corta a SOMA, não só
    // cada linha — Azul-M x2 + Azul-P x4 fica 2 + 3.
    expect(
      aplicarCatalogoAoCarrinho(
        [item([M], 2), item([P], 4)],
        hoje((v) => v),
      ).map((i) => [i.outrasVariantIds, i.quantity]),
    ).toEqual([
      [[M], 2],
      [[P], 3],
    ]);

    // Nada mudou: devolve o MESMO array (não dispara gravação à toa).
    const igual = hoje((v) => v);
    const itens = [item([P], 1)];
    itens[0].product = montarCatalogo(["p1"], [linha], variantes).produtos.get(
      "p1",
    )!;
    expect(aplicarCatalogoAoCarrinho(itens, igual)).toBe(itens);
  });
});
