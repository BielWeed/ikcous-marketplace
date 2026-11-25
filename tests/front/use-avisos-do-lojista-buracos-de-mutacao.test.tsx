// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), `useAvisosDoLojista` (o sino e a lista de
// Avisos do painel). Defeitos de UMA linha que os três testes vizinhos
// deixavam passar:
//  1. o PRAZO de cada fonte: 15 s, nem antes (fonte lenta virava "falha") nem
//     depois (tela presa em "Atualizando...");
//  2. o filtro EXATO que o estoque pede ao servidor (nenhuma chave a mais);
//  3. a devolução pedir o status `solicitada` (só ele acende o sino);
//  4. "erro" ganha de "dado": resposta com erro E número (devolução,
//     privacidade) é falha da fonte, nunca um aviso com número que não vale;
//  5. nomes das avaliações: no máximo 100 ids por consulta e sem repetir id;
//  6. autores dos cancelamentos: sem repetir id e sem id vazio na consulta de
//     papéis;
//  7. `recarregar` volta a mostrar "carregando" (a tela diz que está
//     atualizando, em vez de parecer parada).
// Ids, nomes e valores inventados; nenhuma chamada de rede.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadas: [] as Array<[string, string, ...unknown[]]>,
  rpcs: [] as Array<[string, unknown]>,
  respostas: {} as Record<string, unknown>,
  respostaDevolucoes: undefined as unknown,
  pedidosPendurado: false,
  loadProducts: vi.fn(),
}));

function construir(tabela: string) {
  const b: Record<string, unknown> = {};
  let ehRecebimento = false;
  for (const nome of [
    "select",
    "in",
    "or",
    "is",
    "not",
    "gte",
    "order",
    "limit",
    "range",
    "contains",
  ]) {
    Reflect.set(
      b,
      nome,
      vi.fn((...args: unknown[]) => {
        h.chamadas.push([tabela, nome, ...args]);
        return b;
      }),
    );
  }
  b.eq = vi.fn((coluna: string, valor: string) => {
    h.chamadas.push([tabela, "eq", coluna, valor]);
    if (coluna === "status" && valor === "delivered") ehRecebimento = true;
    return b;
  });
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: dubla o query builder thenable do Supabase
  b.then = (resolve: unknown, reject?: unknown) => {
    let resposta: Promise<unknown>;
    if (tabela === "marketplace_orders" && ehRecebimento) {
      resposta = Promise.resolve({ data: [], error: null });
    } else if (tabela === "marketplace_orders" && h.pedidosPendurado) {
      resposta = new Promise(() => {});
    } else {
      resposta = Promise.resolve(
        Reflect.get(h.respostas, tabela) ?? { data: [], count: 0, error: null },
      );
    }
    return resposta.then(resolve as never, reject as never);
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => construir(tabela)),
    rpc: vi.fn((nome: string, args: unknown) => {
      h.rpcs.push([nome, args]);
      return Promise.resolve(
        nome === "admin_devolucoes_listar"
          ? (h.respostaDevolucoes ?? {
              data: { total: 0, contagem: { solicitada: 0 }, itens: [] },
              error: null,
            })
          : { data: { total_count: 0 }, error: null },
      );
    }),
  },
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: h.loadProducts }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Leitura {
  avisos: Array<{ tipo: string }>;
  carregando: boolean;
  fontesComFalha: string[];
  recarregar: () => void;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montar() {
  const { useAvisosDoLojista } = await import("@/hooks/useAvisosDoLojista");
  const leituras: Leitura[] = [];
  function Sonda() {
    leituras.push(useAvisosDoLojista() as unknown as Leitura);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});
  return () => leituras[leituras.length - 1];
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const chamadasDe = (tabela: string, metodo: string) =>
  h.chamadas.filter((c) => c[0] === tabela && c[1] === metodo);

beforeEach(() => {
  h.chamadas.length = 0;
  h.rpcs.length = 0;
  h.respostas = {};
  h.respostaDevolucoes = undefined;
  h.pedidosPendurado = false;
  h.loadProducts.mockReset();
  h.loadProducts.mockImplementation(() =>
    Promise.resolve({ products: [], total: 0 }),
  );
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => raiz.unmount());
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useAvisosDoLojista: o prazo de cada fonte é de 15 segundos", () => {
  it("14,999 s de espera ainda é 'atualizando'; aos 15 s a fonte vira falha", async () => {
    vi.useFakeTimers();
    h.pedidosPendurado = true;
    const atual = await montar();

    await passar(14_999);
    expect(atual().carregando).toBe(true);
    expect(atual().fontesComFalha).toEqual([]);

    await passar(1);
    expect(atual().carregando).toBe(false);
    expect(atual().fontesComFalha).toEqual(["pedido"]);
  });
});

describe("useAvisosDoLojista: o que cada fonte pede", () => {
  it("o estoque pede ao servidor exatamente: sem aviso na tela, só ativos, estoque baixo", async () => {
    await montar();
    expect(h.loadProducts).toHaveBeenCalledWith(0, 200, {
      silent: true,
      stock: "low",
      status: "active",
    });
  });

  it("devolução: pede só as solicitadas, de uma em uma (só o total interessa)", async () => {
    await montar();
    expect(h.rpcs).toContainEqual([
      "admin_devolucoes_listar",
      { p_status: "solicitada", p_limite: 1 },
    ]);
  });
});

describe("useAvisosDoLojista: erro ganha de dado", () => {
  it("devolução com erro E com contagem: é falha da fonte, não vira aviso", async () => {
    h.respostaDevolucoes = {
      data: { total: 4, contagem: { solicitada: 4 }, itens: [] },
      error: { message: "falha inventada" },
    };
    const atual = await montar();
    expect(atual().fontesComFalha).toContain("devolucao");
    expect(atual().avisos.map((a) => a.tipo)).not.toContain("devolucao");
  });

  it("privacidade com erro E com contagem: é falha da fonte, não vira aviso", async () => {
    h.respostas.pedidos_de_privacidade = {
      data: null,
      count: 5,
      error: { message: "falha inventada" },
    };
    const atual = await montar();
    expect(atual().fontesComFalha).toContain("privacidade");
    expect(atual().avisos.map((a) => a.tipo)).not.toContain("privacidade");
  });
});

function avaliacao(indice: number, produto: string) {
  return {
    id: `av-${indice}`,
    product_id: produto,
    rating: 5,
    created_at: "2026-11-24T11:00:00.000Z",
    status: "pendente",
  };
}

describe("useAvisosDoLojista: nomes dos produtos avaliados", () => {
  it("101 produtos diferentes: a consulta dos nomes leva no máximo 100 ids", async () => {
    h.respostas.reviews = {
      data: Array.from({ length: 101 }, (_, i) =>
        avaliacao(i, `prod-${String(i).padStart(3, "0")}`),
      ),
      count: 101,
      error: null,
    };
    await montar();
    const consulta = chamadasDe("vw_produtos_admin", "in");
    expect(consulta).toHaveLength(1);
    expect((consulta[0][3] as string[]).length).toBe(100);
  });

  it("três avaliações do MESMO produto: o id vai uma vez só", async () => {
    h.respostas.reviews = {
      data: [
        avaliacao(1, "prod-unico"),
        avaliacao(2, "prod-unico"),
        avaliacao(3, "prod-unico"),
      ],
      count: 3,
      error: null,
    };
    await montar();
    const consulta = chamadasDe("vw_produtos_admin", "in");
    expect(consulta).toHaveLength(1);
    expect(consulta[0][3]).toEqual(["prod-unico"]);
  });
});

const CLIENTE = "c1111111-1111-4111-8111-111111111111";

function cancelamento(indice: number, autor: string | null) {
  const pedido = `3f2a1b8c-4d5e-4f60-9a7b-${String(indice).padStart(12, "0")}`;
  return {
    id: `h${indice}`,
    order_id: pedido,
    old_status: "pending",
    created_by: autor,
    created_at: "2026-11-24T11:00:00.000Z",
    marketplace_orders: {
      id: pedido,
      user_id: autor,
      customer_name: "Maria Silva",
      total: 149.9,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: false,
    },
  };
}

describe("useAvisosDoLojista: papéis dos autores dos cancelamentos", () => {
  it("dois cancelamentos da mesma pessoa: a consulta de papéis leva o id uma vez só", async () => {
    h.respostas.marketplace_order_history = {
      data: [cancelamento(1, CLIENTE), cancelamento(2, CLIENTE)],
      count: 2,
      error: null,
    };
    h.respostas.profiles = {
      data: [{ id: CLIENTE, role: "customer" }],
      error: null,
    };
    await montar();
    const consulta = chamadasDe("profiles", "in");
    expect(consulta).toHaveLength(1);
    expect(consulta[0][3]).toEqual([CLIENTE]);
  });

  it("linha sem autor não leva id vazio para a consulta de papéis", async () => {
    h.respostas.marketplace_order_history = {
      data: [cancelamento(1, CLIENTE), cancelamento(2, null)],
      count: 2,
      error: null,
    };
    h.respostas.profiles = {
      data: [{ id: CLIENTE, role: "customer" }],
      error: null,
    };
    await montar();
    const consulta = chamadasDe("profiles", "in");
    expect(consulta).toHaveLength(1);
    expect(consulta[0][3]).toEqual([CLIENTE]);
  });
});

describe("useAvisosDoLojista: recarregar diz que está atualizando", () => {
  it("depois de pronta, a lista volta a 'carregando' assim que se pede para recarregar", async () => {
    vi.useFakeTimers();
    const atual = await montar();
    expect(atual().carregando).toBe(false);

    // A próxima rodada fica esperando a fonte de pedidos.
    h.pedidosPendurado = true;
    await act(async () => {
      atual().recarregar();
    });
    expect(atual().carregando).toBe(true);
  });
});
