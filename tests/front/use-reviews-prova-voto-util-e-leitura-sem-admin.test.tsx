// @vitest-environment jsdom
//
// Prova do hook REAL de avaliações em dois caminhos que ficaram sem prova:
//
//  1. Voto "Útil" (`markHelpful`): a RPC recebe o id da AVALIAÇÃO tocada, a
//     releitura traz o contador confirmado só daquela avaliação, e sem login ou
//     sem produto aberto nada é enviado. Os vizinhos só viam o cartão; trocar o
//     id enviado à RPC (ou o da releitura) por outro mantinha tudo verde, e o
//     voto cairia na avaliação errada.
//  2. Leitura de reserva do painel (`getAllReviews` sem ser admin): paginação,
//     filtro de nota, busca com caracteres que quebram o filtro `.or()` do
//     PostgREST, valor padrão de quem não achou nada e métricas.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "cliente-1" } as { id: string } | null,
  isAdmin: false,
  chamadas: [] as unknown[][],
  respostas: new Map<string, unknown>(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

function construtor(tabela: string) {
  const registrar =
    (metodo: string) =>
    (...args: unknown[]) => {
      h.chamadas.push([tabela, metodo, ...args]);
      return b;
    };
  const b = {
    select: registrar("select"),
    eq: registrar("eq"),
    in: registrar("in"),
    ilike: registrar("ilike"),
    limit: registrar("limit"),
    or: registrar("or"),
    order: registrar("order"),
    range: registrar("range"),
    single: registrar("single"),
    // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
    then: (
      resolver: (v: unknown) => unknown,
      rejeitar: (e: unknown) => unknown,
    ) => {
      const resposta = h.respostas.get(tabela);
      return Promise.resolve(
        typeof resposta === "function"
          ? (resposta as () => unknown)()
          : resposta,
      ).then(resolver, rejeitar);
    },
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => construtor(tabela),
    rpc: (...a: unknown[]) => h.rpc(...a),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: h.isAdmin }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess, info: vi.fn() },
}));
vi.mock("@/utils/admin_cache", () => ({
  lerGeracaoDosCachesDeAdmin: () => 0,
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));

const { useReviews } = await import("@/hooks/useReviews");

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let hook!: () => ReturnType<typeof useReviews>;

function Sonda() {
  const valor = useReviews();
  useEffect(() => {
    hook = () => valor;
  });
  return (
    <output>
      {valor.reviews.map((r) => `${r.id}:${r.helpful}`).join(",")}
    </output>
  );
}

const linhaDoProduto = (id: string, helpful: number) => ({
  id,
  product_id: "prod-1",
  user_id: "outra-cliente",
  user: { nome_publico: "Marina", avatar_url: null },
  rating: 5,
  comment: "Bom",
  verified: false,
  status: "publicada",
  helpful,
  created_at: "2026-11-01T12:00:00Z",
});

beforeEach(async () => {
  vi.clearAllMocks();
  h.user = { id: "cliente-1" };
  h.isAdmin = false;
  h.chamadas = [];
  h.respostas.clear();
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

const chamadasDe = (tabela: string, metodo: string) =>
  h.chamadas.filter((c) => c[0] === tabela && c[1] === metodo);

describe("useReviews (real): voto Útil", () => {
  async function abrirProduto() {
    // A leitura de produto (logada) e a de votos usam tabelas diferentes.
    h.respostas.set("reviews", {
      data: [linhaDoProduto("r-1", 2), linhaDoProduto("r-2", 5)],
      error: null,
    });
    h.respostas.set("review_votes", { data: [], error: null });
    await act(async () => hook().getReviewsByProduct("prod-1"));
    expect(hook().reviews.map((r) => r.id)).toEqual(["r-1", "r-2"]);
  }

  it("manda à RPC o id da avaliação tocada e mostra só o contador dela, vindo da releitura", async () => {
    await abrirProduto();
    h.chamadas = [];
    h.respostas.set("reviews", { data: { helpful: 6 }, error: null });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await hook().markHelpful("r-2");
    });

    expect(resultado).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("increment_helpful", {
      review_id: "r-2",
    });
    // a releitura é da avaliação tocada, e só dela
    expect(chamadasDe("reviews", "select")).toEqual([
      ["reviews", "select", "helpful"],
    ]);
    expect(chamadasDe("reviews", "eq")).toEqual([
      ["reviews", "eq", "id", "r-2"],
    ]);
    expect(hook().reviews.map((r) => `${r.id}:${r.helpful}`)).toEqual([
      "r-1:2",
      "r-2:6",
    ]);
    expect(hook().votosUteis.has("r-2")).toBe(true);
    expect(hook().votosUteis.has("r-1")).toBe(false);
  });

  it("contador nulo na releitura vira 0 (nunca fica vazio na tela)", async () => {
    await abrirProduto();
    h.respostas.set("reviews", { data: { helpful: null }, error: null });

    await act(async () => {
      await hook().markHelpful("r-1");
    });

    expect(hook().reviews.find((r) => r.id === "r-1")?.helpful).toBe(0);
  });

  it("releitura que falha NÃO desfaz o voto: devolve true e mantém o último número", async () => {
    await abrirProduto();
    h.respostas.set("reviews", { data: null, error: new Error("sem leitura") });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await hook().markHelpful("r-2");
    });

    expect(resultado).toBe(true);
    expect(hook().votosUteis.has("r-2")).toBe(true);
    expect(hook().reviews.find((r) => r.id === "r-2")?.helpful).toBe(5);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("a RPC recusa: false, aviso de erro, nenhum voto marcado e o contador fica", async () => {
    await abrirProduto();
    h.rpc.mockResolvedValueOnce({ data: null, error: new Error("negado") });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await hook().markHelpful("r-2");
    });

    expect(resultado).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith("Erro ao marcar como útil.");
    expect(hook().votosUteis.size).toBe(0);
    expect(hook().reviews.find((r) => r.id === "r-2")?.helpful).toBe(5);
  });

  it("sem login: pede o login e não chama a RPC", async () => {
    h.user = null;
    await act(async () => raiz.render(<Sonda />));

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await hook().markHelpful("r-2");
    });

    expect(resultado).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith(
      "Faça login para marcar como útil.",
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sem nenhum produto aberto: não chama a RPC", async () => {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await hook().markHelpful("r-2");
    });

    expect(resultado).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("useReviews (real): leitura de reserva do painel (sem ser admin)", () => {
  const ZERO = "00000000-0000-0000-0000-000000000000";

  const linha = (extra: Record<string, unknown> = {}) => ({
    id: "r-9",
    product_id: "p-9",
    user_id: "u-9",
    rating: 3,
    created_at: "2026-11-02T10:00:00Z",
    ...extra,
  });

  it("sem filtro: lê a tabela, mais nova primeiro, na página pedida, e traz as métricas", async () => {
    h.respostas.set("reviews", { data: [linha()], error: null, count: 41 });
    h.rpc.mockResolvedValueOnce({
      data: [
        { average_rating: "4.25", total_verified: "7", total_replied: "3" },
      ],
      error: null,
    });

    let retorno: Awaited<
      ReturnType<ReturnType<typeof useReviews>["getAllReviews"]>
    >;
    await act(async () => {
      retorno = await hook().getAllReviews(2, 10);
    });

    expect(chamadasDe("reviews", "order")).toEqual([
      ["reviews", "order", "created_at", { ascending: false }],
    ]);
    // página 2 de 10 = linhas 20 a 29
    expect(chamadasDe("reviews", "range")).toEqual([
      ["reviews", "range", 20, 29],
    ]);
    expect(chamadasDe("reviews", "or")).toEqual([]);
    expect(chamadasDe("reviews", "eq")).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("get_reviews_metrics", {
      p_search: null,
      p_rating: null,
    });
    expect(retorno!).toMatchObject({
      total: 41,
      averageRating: 4.25,
      globalVerifiedCount: 7,
      globalRepliedCount: 3,
    });
    // linha incompleta ganha os valores padrão
    expect(retorno!.reviews[0]).toMatchObject({
      id: "r-9",
      customerName: "Anônimo",
      productName: "Produto removido",
      comment: "",
      verified: false,
      status: "publicada",
      helpful: 0,
    });
  });

  it("filtro de nota: filtra a tabela e manda a nota como NÚMERO às métricas; 'all' não filtra", async () => {
    h.respostas.set("reviews", { data: [], error: null, count: 0 });
    await act(async () => {
      await hook().getAllReviews(0, 20, { rating: 4 });
    });
    expect(chamadasDe("reviews", "eq")).toEqual([
      ["reviews", "eq", "rating", 4],
    ]);
    expect(h.rpc).toHaveBeenLastCalledWith("get_reviews_metrics", {
      p_search: null,
      p_rating: 4,
    });

    h.chamadas = [];
    await act(async () => {
      await hook().getAllReviews(0, 20, { rating: "all" });
    });
    expect(chamadasDe("reviews", "eq")).toEqual([]);
    expect(h.rpc).toHaveBeenLastCalledWith("get_reviews_metrics", {
      p_search: null,
      p_rating: null,
    });
  });

  it("busca: tira os caracteres que quebram o .or(), limita a 25 achados e junta comentário, cliente e produto", async () => {
    h.respostas.set("public_profiles", {
      data: [{ id: "perfil-1" }, { id: "perfil-2" }],
      error: null,
    });
    h.respostas.set("vw_produtos_admin", {
      data: [{ id: "prod-7" }],
      error: null,
    });
    h.respostas.set("reviews", { data: [], error: null, count: 0 });

    await act(async () => {
      await hook().getAllReviews(0, 20, { search: "bol(sa),.:[x]\\" });
    });

    expect(chamadasDe("public_profiles", "ilike")).toEqual([
      ["public_profiles", "ilike", "full_name", "%bolsax%"],
    ]);
    expect(chamadasDe("vw_produtos_admin", "ilike")).toEqual([
      ["vw_produtos_admin", "ilike", "nome", "%bolsax%"],
    ]);
    expect(chamadasDe("public_profiles", "limit")).toEqual([
      ["public_profiles", "limit", 25],
    ]);
    expect(chamadasDe("vw_produtos_admin", "limit")).toEqual([
      ["vw_produtos_admin", "limit", 25],
    ]);
    expect(chamadasDe("reviews", "or")).toEqual([
      [
        "reviews",
        "or",
        "comment.ilike.%bolsax%,user_id.in.(perfil-1,perfil-2),product_id.in.(prod-7)",
      ],
    ]);
    expect(h.rpc).toHaveBeenLastCalledWith("get_reviews_metrics", {
      p_search: "bol(sa),.:[x]\\",
      p_rating: null,
    });
  });

  it("busca que não acha cliente nem produto usa um id impossível (nunca lista vazia no .or())", async () => {
    h.respostas.set("public_profiles", { data: [], error: null });
    h.respostas.set("vw_produtos_admin", { data: null, error: null });
    h.respostas.set("reviews", { data: [], error: null, count: 0 });

    await act(async () => {
      await hook().getAllReviews(0, 20, { search: "nada" });
    });

    expect(chamadasDe("reviews", "or")).toEqual([
      [
        "reviews",
        "or",
        `comment.ilike.%nada%,user_id.in.(${ZERO}),product_id.in.(${ZERO})`,
      ],
    ]);
  });

  it("falha das métricas não derruba a lista: média e totais ficam em 0", async () => {
    h.respostas.set("reviews", { data: [linha()], error: null, count: 1 });
    h.rpc.mockResolvedValueOnce({ data: null, error: new Error("sem rpc") });

    let retorno: Awaited<
      ReturnType<ReturnType<typeof useReviews>["getAllReviews"]>
    >;
    await act(async () => {
      retorno = await hook().getAllReviews(0, 20);
    });

    expect(retorno!).toMatchObject({
      total: 1,
      averageRating: 0,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
    });
    expect(retorno!.reviews).toHaveLength(1);
  });

  it("falha da leitura: avisa, esvazia a lista e marca o erro (a lista antiga não finge ser o resultado)", async () => {
    h.respostas.set("reviews", {
      data: null,
      error: new Error("caiu"),
      count: null,
    });

    let retorno: unknown = "intacto";
    await act(async () => {
      retorno = await hook().getAllReviews(0, 20);
    });

    expect(retorno).toBeUndefined();
    expect(h.toastError).toHaveBeenCalledWith("Erro ao carregar avaliações.");
    expect(hook().erroDaListagemAdmin).toBe(
      "Não foi possível carregar as avaliações.",
    );
  });
});
