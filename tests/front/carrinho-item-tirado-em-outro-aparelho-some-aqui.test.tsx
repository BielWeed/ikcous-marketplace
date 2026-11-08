// @vitest-environment jsdom
//
// Onda 49, achado 1: a cliente tira um produto do carrinho (ou conclui a
// compra, que esvazia o carrinho) num aparelho; no outro, aberto ao mesmo
// tempo, o produto continuava lá -- a junção punha primeiro TUDO o que havia
// aqui e só depois acrescentava o do banco, e a lápide da remoção mora só no
// aparelho que removeu. Pior: a gravação seguinte do aparelho "atrasado"
// devolvia o item ao banco.
//
// A regra: quando a releitura vem de um evento ao vivo e este aparelho NÃO tem
// edição pendente (o carrinho daqui é igual ao que o banco tinha na última
// conversa com ele), o banco manda e o que sumiu dele some daqui. Com edição
// pendente (item posto sem rede, quantidade mexida e ainda não enviada) a
// junção de sempre fica: a cliente nunca perde o que acabou de fazer.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { criarGerenciadorDeChave } from "@/lib/chave-do-pedido";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  evento: (_payload: unknown) => {},
  sessaoAtiva: true,
  // Quando preenchida, a PRÓXIMA leitura do carrinho no banco fica em voo até
  // `liberar()`; o retrato do banco é o de quando ela COMEÇOU.
  espera: null as null | { promessa: Promise<void>; liberar: () => void },
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
const produtos = [
  {
    id: "p1",
    nome: "Camiseta",
    preco_venda: 10,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
  {
    id: "p2",
    nome: "Bermuda",
    preco_venda: 30,
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
          const dados = { data: mundo.itens.slice(), error: null };
          const espera = mundo.espera;
          mundo.espera = null;
          return espera
            ? espera.promessa.then(() => dados)
            : Promise.resolve(dados);
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
        data: { session: mundo.sessaoAtiva ? { user: usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (_tipo: unknown, _filtro: unknown, evento: typeof mundo.evento) => {
        mundo.evento = evento;
        return { subscribe: () => ({}) };
      },
    }),
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  mundo.sessaoAtiva = true;
  mundo.espera = null;
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
// Passa o tempo de espera da gravação (1 s) e deixa as promessas se resolverem.
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
// O evento ao vivo do banco ("o carrinho mudou") e a releitura que ele dispara.
async function chegaEventoDoBanco() {
  await act(async () => {
    mundo.evento({ eventType: "DELETE" });
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
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });

describe("carrinho: o que outro aparelho tirou some aqui (e só isso)", () => {
  it("o produto tirado no celular some do computador quando nada daqui ficou por enviar", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    await sincronizar();

    const gravacoesAntes = mundo.rpc.mock.calls.length;
    mundo.itens = [linhaDoBanco("p1")];
    await chegaEventoDoBanco();

    expect(idsDoCarrinho()).toEqual(["p1"]);
    // E não volta ao banco: o computador não regrava o carrinho que acabou de
    // ler (seria uma visão de segundos atrás por cima do que o outro aparelho
    // pode ter posto nesse meio tempo).
    await sincronizar();
    expect(mundo.rpc.mock.calls.length).toBe(gravacoesAntes);
  });

  it("sem ter gravado nada aqui (só abriu o app), a remoção feita no outro aparelho também vale", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    // Carrinho guardado neste aparelho, igual ao do banco.
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto("p1"),
          quantity: 1,
          lastModifiedAt: Date.now() - 1000,
        },
        {
          product: produto("p2"),
          quantity: 1,
          lastModifiedAt: Date.now() - 1000,
        },
      ]),
    );
    await montar();
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);

    mundo.itens = [linhaDoBanco("p1")];
    await chegaEventoDoBanco();

    expect(idsDoCarrinho()).toEqual(["p1"]);
  });

  it("carrinho esvaziado pelo pedido feito no outro aparelho esvazia este também", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.itens = [];
    await chegaEventoDoBanco();

    expect(atual.cart).toEqual([]);
  });

  it("o que a cliente pôs aqui SEM REDE não some quando chega a releitura do banco", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    mundo.rpc.mockResolvedValue({ error: { message: "sem rede" } });
    await act(async () => atual.addToCart(produto("p2"), 1));
    await sincronizar(); // a gravação falha; o banco segue sem p2

    await chegaEventoDoBanco();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });

  it("quantidade mexida e ainda não enviada vale como edição pendente: a junção de sempre fica", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    // Toque no "+" do p1 e, antes de a gravação sair, chega a notícia de que
    // o p2 foi tirado no outro aparelho.
    await act(async () => atual.updateQuantity("p1", 3));
    mundo.itens = [linhaDoBanco("p1")];
    await chegaEventoDoBanco();

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 3],
      ["p2", 1],
    ]);
  });

  it("releitura sem mudança não mexe no carrinho nem grava de novo", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    const gravacoes = mundo.rpc.mock.calls.length;

    await chegaEventoDoBanco();
    await sincronizar();

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 1],
      ["p2", 1],
    ]);
    expect(mundo.rpc.mock.calls.length).toBe(gravacoes);
  });

  it("releitura que COMEÇOU antes de a gravação terminar não derruba o item recém-gravado", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    // A leitura começa agora e vê o banco SEM p2...
    let liberar = () => {};
    const promessa = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    mundo.espera = { promessa, liberar };
    await act(async () => {
      mundo.evento({ eventType: "UPDATE" });
      await vi.advanceTimersByTimeAsync(10);
    });
    // ...a cliente põe o p2 e a gravação dele termina com sucesso...
    await act(async () => atual.addToCart(produto("p2"), 1));
    await sincronizar();
    expect(mundo.rpc).toHaveBeenCalled();
    // ...e só então a leitura velha volta, com o retrato de antes da gravação.
    await act(async () => {
      liberar();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });

  it("sem sessão válida a leitura vazia não é confiável: o carrinho não é esvaziado", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.sessaoAtiva = false;
    mundo.itens = []; // o que o banco devolve a quem não está autenticado
    await chegaEventoDoBanco();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });

  it("pedido enviado e sem resposta segura o carrinho (a chave do pedido não gira)", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u1" }).chavePara(
      "impressao-do-pedido",
    );

    mundo.itens = [linhaDoBanco("p1")];
    await chegaEventoDoBanco();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });
});
