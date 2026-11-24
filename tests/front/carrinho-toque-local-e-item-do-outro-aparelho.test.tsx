// @vitest-environment jsdom
//
// Black Friday: os avisos do canal ao vivo do carrinho viram UMA releitura
// (500 ms depois do aviso, ou fim da gravação + 1,5 s). Mas `sync_cart_atomic`
// APAGA o carrinho salvo e grava o deste aparelho no lugar, e a próxima gravação
// daqui sai ~1 s depois de cada toque. Se essa gravação saísse ANTES da
// releitura atrasada, ela apagaria no banco o item que o outro aparelho acabou
// de pôr; a releitura depois leria o banco já sem o item, e ele sumiria dos
// DOIS aparelhos.
//
// Regra agora: o efeito que grava, quando há releitura devida, RELÊ em vez de
// gravar (mesmo padrão de "banco ainda desconhecido: não grava, relê"). A
// junção acrescenta o item de fora, nada daqui pendente é perdido, e a gravação
// seguinte leva os dois. O banco falso abaixo faz o que a RPC real faz:
// substitui o carrinho inteiro a cada gravação.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
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
  falharAsProximasLeituras: 0,
  logado: true,
  aoEvento: null as null | ((payload: unknown) => void),
  rpc: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "cliente" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.logado ? usuario : null, loading: false }),
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
            if (tabela === "cart_items") {
              mundo.leiturasDoCarrinho += 1;
              if (mundo.falharAsProximasLeituras > 0) {
                mundo.falharAsProximasLeituras -= 1;
                return { data: null, error: { message: "rede caiu" } };
              }
            }
            return {
              data: mundo.linhas
                .filter((linha) =>
                  Object.entries(linha).some(
                    ([chave, v]) => chave === coluna && v === valor,
                  ),
                )
                .map((linha) => ({ ...linha })),
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
      getSession: async () => ({
        data: { session: mundo.logado ? { user: usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (_tipo: unknown, _config: unknown, retorno: (p: unknown) => void) => {
        mundo.aoEvento = retorno;
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
function linha(product_id: string): Linha {
  return {
    user_id: "cliente",
    product_id,
    variant_id: "",
    quantity: 1,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
/** O que a RPC `sync_cart_atomic` faz: o carrinho enviado SUBSTITUI o salvo. */
function gravarNoBanco(itens: Record<string, unknown>[]) {
  mundo.linhas = itens.map((item) => ({
    user_id: "cliente",
    product_id: item.product_id,
    variant_id: item.variant_id,
    quantity: item.quantity,
    updated_at: item.updated_at,
  }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.leiturasDoCarrinho = 0;
  mundo.falharAsProximasLeituras = 0;
  mundo.logado = true;
  mundo.aoEvento = null;
  mundo.linhas = [linha("p1")];
  mundo.rpc.mockImplementation(
    async (
      _nome: string,
      args: { p_cart_items: Record<string, unknown>[] },
    ) => {
      gravarNoBanco(args.p_cart_items);
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
/**
 * Deixa o tempo correr em passos curtos, cada um com o seu `act`: o que o
 * React agenda no meio (a junção muda o carrinho, o efeito arma o timer da
 * gravação) só roda quando o `act` fecha, e um salto único de 10 s passaria
 * por cima dele.
 */
async function passarTempo(ms: number) {
  for (let gasto = 0; gasto < ms; gasto += 250) await avancar(250);
}
async function eventoDoBanco() {
  await act(async () => {
    mundo.aoEvento?.({ eventType: "INSERT" });
  });
}
/** O outro aparelho grava p2 no banco e o canal avisa este. */
async function outroAparelhoPoeP2() {
  mundo.linhas = [...mundo.linhas, linha("p2")];
  await eventoDoBanco();
}
/** Monta, deixa a leitura de entrada acabar e o canal ficar "quieto". */
async function montarEAssentar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  await passarTempo(12_000);
  expect(mundo.aoEvento).not.toBeNull();
}
/** `produto:quantidade` de cada linha, em ordem, para comparar de uma vez. */
const noBanco = () =>
  mundo.linhas.map((l) => `${l.product_id}x${l.quantity}`).sort();
const aqui = () =>
  atual.cart.map((i) => `${i.product.id}x${i.quantity}`).sort();

describe("carrinho: o toque daqui não apaga o item que o outro aparelho acabou de pôr", () => {
  it("cenário 1: toca + durante a gravação, e o outro aparelho põe p2 logo depois dela", async () => {
    await montarEAssentar();

    // A primeira gravação (p9) fica em voo até o teste mandar.
    let concluir: () => void = () => {};
    mundo.rpc.mockImplementationOnce(
      (_nome: string, args: { p_cart_items: Record<string, unknown>[] }) =>
        new Promise((resolver) => {
          concluir = () => {
            gravarNoBanco(args.p_cart_items);
            resolver({ error: null });
          };
        }),
    );
    await act(async () => atual.addToCart(produto("p9"), 1));
    await avancar(1100);
    // O toque em p1 chega com a gravação de p9 ainda em voo.
    await act(async () => atual.addToCart(produto("p1"), 1));
    await avancar(100);
    await act(async () => {
      concluir();
    });
    await avancar(200);
    await outroAparelhoPoeP2();
    await passarTempo(10_000);

    // Nada se perde, nem do banco nem daqui: o toque (p1x2), o p9 e o p2.
    expect(noBanco()).toEqual(["p1x2", "p2x1", "p9x1"]);
    expect(aqui()).toEqual(["p1x2", "p2x1", "p9x1"]);
  });

  it("cenário 2: toca + sem gravação em voo, e 600 ms depois o outro aparelho põe p2", async () => {
    await montarEAssentar();

    await act(async () => atual.addToCart(produto("p1"), 1));
    await avancar(600);
    await outroAparelhoPoeP2();
    await passarTempo(10_000);

    expect(noBanco()).toEqual(["p1x2", "p2x1"]);
    expect(aqui()).toEqual(["p1x2", "p2x1"]);
  });

  it("a economia fica: UMA releitura por gravação, e nenhuma sobra agendada depois", async () => {
    await montarEAssentar();
    const base = mundo.leiturasDoCarrinho;

    await act(async () => atual.addToCart(produto("p1"), 1));
    await avancar(600);
    await outroAparelhoPoeP2();
    await passarTempo(10_000);

    // A releitura devida aconteceu no lugar da gravação; o que ela mesma
    // provocou (gravar a união) não é lido de novo por quem gravou.
    expect(mundo.leiturasDoCarrinho).toBe(base + 1);
    expect(noBanco()).toEqual(["p1x2", "p2x1"]);
  });

  it("sem aviso nenhum o toque grava como sempre, sem ler o banco antes", async () => {
    await montarEAssentar();
    const base = mundo.leiturasDoCarrinho;
    const gravacoesAntes = mundo.rpc.mock.calls.length;

    await act(async () => atual.addToCart(produto("p9"), 1));
    await avancar(1100);

    expect(mundo.rpc.mock.calls.length).toBe(gravacoesAntes + 1);
    expect(mundo.leiturasDoCarrinho).toBe(base);
    expect(noBanco()).toEqual(["p1x1", "p9x1"]);
  });

  it("a edição daqui nunca se perde: o item do outro aparelho entra E a quantidade tocada fica", async () => {
    await montarEAssentar();

    await act(async () => atual.addToCart(produto("p1"), 2));
    await avancar(300);
    await outroAparelhoPoeP2();
    await passarTempo(10_000);

    expect(aqui()).toEqual(["p1x3", "p2x1"]);
    expect(noBanco()).toEqual(["p1x3", "p2x1"]);
  });

  it("a releitura que falha não deixa a edição daqui sem gravar", async () => {
    await montarEAssentar();

    await act(async () => atual.addToCart(produto("p1"), 1));
    await avancar(600);
    await outroAparelhoPoeP2();
    // A leitura que entrou no lugar da gravação cai por falha de rede.
    mundo.falharAsProximasLeituras = 1;
    await passarTempo(10_000);

    // Falhou uma leitura e a edição daqui continua indo ao banco: a gravação
    // não fica refém de uma leitura que não volta (mesmo comportamento de antes
    // do agrupamento dos avisos).
    expect(mundo.falharAsProximasLeituras).toBe(0);
    expect(noBanco()).toContain("p1x2");
    expect(aqui()).toContain("p1x2");
  });

  it("desmontar com releitura devida e toque pendente: não lê nem grava depois", async () => {
    await montarEAssentar();
    const base = mundo.leiturasDoCarrinho;

    await act(async () => atual.addToCart(produto("p1"), 1));
    await avancar(300);
    await eventoDoBanco();
    const gravacoes = mundo.rpc.mock.calls.length;
    act(() => raiz.unmount());
    await passarTempo(10_000);

    expect(mundo.leiturasDoCarrinho).toBe(base);
    expect(mundo.rpc.mock.calls.length).toBe(gravacoes);
    // O afterEach desmonta de novo: refaz a raiz para ele não falhar.
    raiz = createRoot(hospedeiro);
  });

  it("visitante (sem conta) não lê nem grava o banco, mesmo com aviso solto", async () => {
    mundo.logado = false;
    await act(async () =>
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      ),
    );
    await passarTempo(12_000);
    await act(async () => atual.addToCart(produto("p1"), 1));
    await passarTempo(5000);

    expect(mundo.leiturasDoCarrinho).toBe(0);
    expect(mundo.rpc).not.toHaveBeenCalled();
    expect(aqui()).toEqual(["p1x1"]);
  });
});
