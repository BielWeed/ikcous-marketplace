// @vitest-environment jsdom
//
// Onda 52, achado do carrinho: a cliente deixa o app aberto no celular, o
// socket em tempo real cai no segundo plano (o aviso "o carrinho mudou" que
// chega com ele fora nunca mais é reenviado), ela põe uma camiseta no carrinho
// pelo computador e volta ao celular. Ao voltar o app só relia o CATALOGO
// (preço e estoque), nunca o carrinho do banco; na primeira edição o celular
// mandava o carrinho velho inteiro e a gravação substitui o carrinho salvo --
// a camiseta sumia do banco, e do computador.
//
// A regra agora: com conta, voltar a ficar visível (e voltar a ficar online)
// faz a MESMA releitura que o aviso ao vivo faz (junção de sempre: edição
// pendente nunca é sobrescrita; sem edição pendente o banco manda). Visitante
// não tem banco para ler; pedido enviado e sem resposta segura o carrinho.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { criarGerenciadorDeChave } from "@/lib/chave-do-pedido";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  leiturasDoCarrinho: 0,
  falhaNaLeituraDoCarrinho: false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = [
  {
    id: "p1",
    nome: "Bermuda",
    preco_venda: 30,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
  {
    id: "p2",
    nome: "Bone",
    preco_venda: 20,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
  {
    id: "p3",
    nome: "Camiseta",
    preco_venda: 10,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          if (tabela === "cart_items") mundo.leiturasDoCarrinho += 1;
          if (tabela === "cart_items" && mundo.falhaNaLeituraDoCarrinho) {
            return Promise.resolve({
              data: null,
              error: { message: "rede caiu" },
            });
          }
          return Promise.resolve({ data: mundo.itens.slice(), error: null });
        },
        in: async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: mundo.usuario ? { user: mundo.usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    // O socket em tempo real NUNCA entrega nada neste arquivo: é o ponto.
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
let visibilidade: "visible" | "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.usuario = { id: "u1" };
  mundo.itens = [];
  mundo.leiturasDoCarrinho = 0;
  mundo.falhaNaLeituraDoCarrinho = false;
  // O banco de verdade: a gravação SUBSTITUI o carrinho salvo.
  mundo.rpc.mockImplementation(
    async (
      _nome: string,
      args: { p_cart_items: { product_id: string; quantity: number }[] },
    ) => {
      mundo.itens = args.p_cart_items.map((i) =>
        linhaDoBanco(i.product_id, i.quantity),
      );
      return { error: null };
    },
  );
  localStorage.clear();
  sessionStorage.clear();
  visibilidade = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
  });
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
  vi.unstubAllGlobals();
  // biome-ignore lint/performance/noDelete: volta ao getter nativo do jsdom
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

async function montar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}
// Passa o tempo de espera da gravação (1 s) e deixa as promessas se resolverem.
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
// O app foi para o segundo plano e voltou depois de um bom tempo.
async function voltarDoSegundoPlano(depoisDeMs = 60_000) {
  visibilidade = "hidden";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(depoisDeMs);
  });
  visibilidade = "visible";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);
  });
}
function linhaDoBanco(productId: string, quantity = 1) {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
const idsDoCarrinho = () => atual.cart.map((i) => i.product.id);
const idsNoBanco = () => mundo.itens.map((i) => i.product_id);
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });

describe("carrinho com conta: ao voltar do segundo plano, traz o que outro aparelho pôs", () => {
  it("a camiseta posta no computador aparece no celular ao voltar, e a edição seguinte NÃO a apaga do banco", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);

    // Outro aparelho gravou a camiseta; o aviso ao vivo se perdeu.
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2"), linhaDoBanco("p3")];
    await voltarDoSegundoPlano();
    expect(idsDoCarrinho()).toEqual(["p1", "p2", "p3"]);

    // A cliente mexe em OUTRO item: a gravação leva o carrinho completo.
    await act(async () => atual.updateQuantity("p1", 3));
    await sincronizar();

    expect(idsNoBanco().sort()).toEqual(["p1", "p2", "p3"]);
    expect(mundo.itens.find((i) => i.product_id === "p1")?.quantity).toBe(3);
  });

  it("sem nada de novo no banco, voltar não muda o carrinho nem grava", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    const gravacoes = mundo.rpc.mock.calls.length;

    await voltarDoSegundoPlano();
    await sincronizar();

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 1],
      ["p2", 1],
    ]);
    expect(mundo.rpc.mock.calls.length).toBe(gravacoes);
  });

  it("o que outro aparelho TIROU também some ao voltar, quando nada daqui ficou por enviar", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.itens = [linhaDoBanco("p1")];
    await voltarDoSegundoPlano();

    expect(idsDoCarrinho()).toEqual(["p1"]);
  });

  it("edição pendente daqui não é sobrescrita: a quantidade mexida fica e o item novo entra", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    // Toque no "+" do p1 e, ANTES de a gravação sair (espera de 1 s), o app
    // volta do segundo plano com o banco já diferente (p3 posto, p2 tirado).
    await act(async () => atual.updateQuantity("p1", 4));
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p3")];
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mundo.leiturasDoCarrinho).toBeGreaterThan(1);
    expect(atual.cart.find((i) => i.product.id === "p1")?.quantity).toBe(4);
    expect(idsDoCarrinho()).toContain("p3");
    expect(idsDoCarrinho()).toContain("p2");
  });

  it("a leitura do banco FALHA ao voltar: o carrinho fica como estava, sem apagar nada", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    mundo.falhaNaLeituraDoCarrinho = true;
    await voltarDoSegundoPlano();
    erro.mockRestore();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    expect(idsNoBanco()).toEqual(["p1", "p2"]);
  });

  it("vai e volta várias vezes em poucos segundos: o banco é lido uma vez só", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    await voltarDoSegundoPlano();
    const aposAPrimeira = mundo.leiturasDoCarrinho;
    await voltarDoSegundoPlano(500);
    await voltarDoSegundoPlano(500);

    expect(mundo.leiturasDoCarrinho).toBe(aposAPrimeira);
  });

  it("o app escondido (indo para o segundo plano) não lê o banco", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    const leituras = mundo.leiturasDoCarrinho;

    visibilidade = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mundo.leiturasDoCarrinho).toBe(leituras);
  });

  it("pedido enviado e sem resposta segura o carrinho ao voltar (a chave do pedido não gira)", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u1" }).chavePara(
      "impressao-do-pedido",
    );

    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2"), linhaDoBanco("p3")];
    await voltarDoSegundoPlano();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });

  it("a rede que volta (evento online) também traz o que outro aparelho pôs nesse meio tempo", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p3")];
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(idsDoCarrinho()).toEqual(["p1", "p3"]);
  });

  it("a rede que volta sem nada de novo no banco não muda nem regrava o carrinho", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    const gravacoes = mundo.rpc.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(50);
    });
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    expect(mundo.rpc.mock.calls.length).toBe(gravacoes);
  });
});

describe("visitante (sem conta): não há carrinho no banco para ler", () => {
  it("voltar do segundo plano não toca no carrinho do banco e deixa o carrinho local como está", async () => {
    mundo.usuario = null;
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto("p1"),
          quantity: 2,
          lastModifiedAt: 1_760_000_000_000,
        },
      ]),
    );
    await montar();
    await sincronizar();

    mundo.itens = [linhaDoBanco("p3")]; // de outra conta: nunca deve entrar
    await voltarDoSegundoPlano();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mundo.leiturasDoCarrinho).toBe(0);
    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 2],
    ]);
    expect(mundo.rpc).not.toHaveBeenCalled();
  });
});
