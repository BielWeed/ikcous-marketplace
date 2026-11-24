// @vitest-environment jsdom
//
// Black Friday: o canal ao vivo do carrinho (`cart:<conta>`) relia o banco a
// CADA evento. A gravação (`sync_cart_atomic`) apaga todas as linhas e insere
// todas de novo, então um carrinho de n itens devolvia ≥ n eventos para a
// PRÓPRIA cliente, e cada evento custava 3 consultas HTTP (cart_items,
// produtos, variações).
//
// Regra agora (nenhum evento é descartado -- carrinho aberto em outro aparelho
// da mesma conta tem de continuar sincronizando, inclusive o que ele põe
// enquanto este aparelho grava):
//   - evento que chega com a gravação em voo, ou logo depois dela (janela de
//     1,5 s), pode ser o eco da própria gravação ou de outro aparelho; não dá
//     para distinguir, então eles são JUNTADOS numa única releitura, depois do
//     fim da gravação + janela (1 leitura por gravação, não n × 3 consultas);
//   - eventos fora disso, em rajada, viram UMA releitura 500 ms depois do
//     último; um evento isolado só atrasa essa espera.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { PRAZO_DE_GRAVAR_O_CARRINHO_MS } from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

type Linha = {
  user_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  updated_at: string;
};

const mundo = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  leiturasDoCarrinho: 0,
  aoEvento: null as null | ((payload: unknown) => void),
  rpc: vi.fn(),
  canaisRemovidos: 0,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "cliente" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = ["p1", "p2", "p9"].map((id) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: 10,
  estoque: 20,
  ativo: true,
  imagens: [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () =>
        Object.assign(Promise.resolve({ data: [], error: null }), {
          eq: async (coluna: string, valor: unknown) => {
            if (tabela === "cart_items") mundo.leiturasDoCarrinho += 1;
            return {
              data: mundo.linhas.filter((linha) =>
                Object.entries(linha).some(
                  ([chave, v]) => chave === coluna && v === valor,
                ),
              ),
              error: null,
            };
          },
          in: comPaginacao(async (_coluna: string, ids: string[]) =>
            tabela === "product_variants"
              ? { data: [], error: null }
              : {
                  data: produtos.filter((p) => ids.includes(p.id)),
                  error: null,
                },
          ),
        }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (_tipo: unknown, _config: unknown, retorno: (p: unknown) => void) => {
        mundo.aoEvento = retorno;
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: async () => {
      mundo.canaisRemovidos += 1;
    },
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
function linha(product_id: string): Linha {
  return {
    user_id: "cliente",
    product_id,
    variant_id: "",
    quantity: 1,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.leiturasDoCarrinho = 0;
  mundo.aoEvento = null;
  mundo.canaisRemovidos = 0;
  mundo.linhas = [linha("p1")];
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
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function eventoDoBanco() {
  await act(async () => {
    mundo.aoEvento?.({ eventType: "INSERT" });
  });
}
/** Monta, deixa a leitura de entrada acabar e devolve a contagem de partida. */
async function montarEAssentar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  // A junção da leitura de entrada também grava o carrinho uma vez (e o eco
  // dessa gravação cai na janela): deixa passar o tempo para os testes abaixo
  // começarem com o canal "quieto".
  await avancar(1500);
  await avancar(10_000);
  expect(mundo.aoEvento).not.toBeNull();
  return mundo.leiturasDoCarrinho;
}
/** Uma gravação em voo: a RPC só responde quando o teste mandar. */
function gravacaoEmVoo() {
  let concluir: () => void = () => {};
  mundo.rpc.mockImplementation(
    () =>
      new Promise((resolver) => {
        concluir = () => resolver({ error: null });
      }),
  );
  return {
    concluir: () => {
      concluir();
      // As gravações seguintes voltam a responder na hora.
      mundo.rpc.mockResolvedValue({ error: null });
    },
  };
}
/** Muda o carrinho e deixa a gravação (1 s depois) começar e ficar em voo. */
async function comecarGravacaoEmVoo() {
  const gravacoesAntes = mundo.rpc.mock.calls.length;
  const gravacao = gravacaoEmVoo();
  await act(async () => atual.addToCart(produto("p9"), 1));
  await avancar(1100); // o efeito grava 1 s depois da mudança
  expect(mundo.rpc.mock.calls.length).toBe(gravacoesAntes + 1);
  return gravacao;
}

describe("carrinho ao vivo: o eco da própria gravação vira uma leitura só", () => {
  it("evento isolado de fora: relê UMA vez, até 500 ms depois", async () => {
    const base = await montarEAssentar();

    await eventoDoBanco();
    await avancar(400);
    expect(mundo.leiturasDoCarrinho).toBe(base);
    await avancar(200);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);

    // Nada mais agendado: o tempo passando não relê de novo.
    await avancar(5000);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
  });

  it("rajada de 5 eventos de fora vira UMA leitura", async () => {
    const base = await montarEAssentar();

    for (let i = 0; i < 5; i++) {
      await eventoDoBanco();
      await avancar(100);
    }
    expect(mundo.leiturasDoCarrinho).toBe(base);
    await avancar(600);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
  });

  it("5 eventos durante a gravação em voo: nenhuma leitura enquanto ela dura; UMA depois do fim + janela", async () => {
    const base = await montarEAssentar();
    const gravacao = await comecarGravacaoEmVoo();

    for (let i = 0; i < 5; i++) await eventoDoBanco();
    await avancar(5000); // a gravação segue em voo: nada de ler no meio dela
    expect(mundo.leiturasDoCarrinho).toBe(base);

    await act(async () => {
      gravacao.concluir();
    });
    await avancar(1000); // ainda dentro da janela do eco
    expect(mundo.leiturasDoCarrinho).toBe(base);
    await avancar(1000); // passou o fim da gravação + janela
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);

    // Uma só: nada mais agendado.
    await avancar(10_000);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
  });

  it("eco que chega logo DEPOIS da gravação terminar: UMA leitura no fim da janela; passada ela, evento de fora volta ao debounce de 500 ms", async () => {
    const base = await montarEAssentar();
    const gravacao = await comecarGravacaoEmVoo();
    await act(async () => {
      gravacao.concluir();
    });
    await avancar(200);

    // O Realtime entrega as linhas inseridas depois da resposta da RPC.
    for (let i = 0; i < 5; i++) await eventoDoBanco();
    await avancar(1000);
    expect(mundo.leiturasDoCarrinho).toBe(base);
    await avancar(600);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);

    // Bem depois da gravação, o evento é de outro aparelho: debounce de 500 ms.
    await avancar(10_000);
    await eventoDoBanco();
    await avancar(400);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
    await avancar(200);
    expect(mundo.leiturasDoCarrinho).toBe(base + 2);
  });

  it("item posto no OUTRO aparelho DURANTE a gravação daqui aparece depois dela", async () => {
    await montarEAssentar();
    const gravacao = await comecarGravacaoEmVoo();

    // Enquanto este aparelho grava p9, o outro grava p2 (último a escrever):
    // o banco acaba com os três e avisa. Não dá para saber, pelo evento, se
    // é o eco daqui ou o outro aparelho.
    mundo.linhas = [linha("p1"), linha("p9"), linha("p2")];
    await eventoDoBanco();
    await avancar(2000);
    expect(atual.cart.map((i) => i.product.id)).not.toContain("p2");

    await act(async () => {
      gravacao.concluir();
    });
    await avancar(2000);

    expect(atual.cart.map((i) => i.product.id).sort()).toEqual([
      "p1",
      "p2",
      "p9",
    ]);
  });

  it("gravação que trava até o prazo: a leitura juntada acontece quando ela estoura, não fica pendurada", async () => {
    const base = await montarEAssentar();
    const gravacoesAntes = mundo.rpc.mock.calls.length;
    // A primeira RPC nunca responde; as seguintes (o reenvio) respondem.
    mundo.rpc.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => atual.addToCart(produto("p9"), 1));
    await avancar(1100);
    expect(mundo.rpc.mock.calls.length).toBe(gravacoesAntes + 1);

    await eventoDoBanco();
    await avancar(PRAZO_DE_GRAVAR_O_CARRINHO_MS - 2000);
    expect(mundo.leiturasDoCarrinho).toBe(base);

    // Estoura o prazo (a gravação falha) e passa a janela: UMA leitura.
    await avancar(2000 + 1600);
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
  });

  it("o carrinho aberto em OUTRO aparelho da mesma conta continua aparecendo aqui", async () => {
    await montarEAssentar();
    expect(atual.cart.map((i) => i.product.id)).toEqual(["p1"]);

    // O outro aparelho adicionou p2 e o banco avisa.
    mundo.linhas = [linha("p1"), linha("p2")];
    await eventoDoBanco();
    await avancar(600);

    expect(atual.cart.map((i) => i.product.id).sort()).toEqual(["p1", "p2"]);
  });

  it("desmontar com uma releitura agendada não relê depois", async () => {
    const base = await montarEAssentar();

    await eventoDoBanco();
    act(() => raiz.unmount());
    await avancar(2000);

    expect(mundo.leiturasDoCarrinho).toBe(base);
    // O afterEach desmonta de novo: refaz a raiz para ele não falhar.
    raiz = createRoot(hospedeiro);
  });

  it("desmontar com a leitura juntada esperando o fim da gravação: ela não relê quando a gravação termina", async () => {
    const base = await montarEAssentar();
    const gravacao = await comecarGravacaoEmVoo();

    await eventoDoBanco();
    act(() => raiz.unmount());
    await act(async () => {
      gravacao.concluir();
    });
    await avancar(5000);

    expect(mundo.leiturasDoCarrinho).toBe(base);
    raiz = createRoot(hospedeiro);
  });
});
