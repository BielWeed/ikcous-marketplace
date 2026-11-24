// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), lista de avaliações do PAINEL. O mapeamento
// da `get_admin_reviews_paged` tem valores padrão para a linha que chega
// incompleta (autor ou produto apagado, avaliação antiga sem situação, sem
// voto, sem comentário). Nenhum teste lia essas saídas: trocar `?? "publicada"`
// por `?? "pendente"` (a avaliação antiga cairia na fila de moderação),
// `|| "Anônimo"` por outro texto, ou tirar o `?? 0` do "útil" mantinha a suíte
// verde. O teste devolve a linha CRUA da RPC (entrada, nunca a conclusão) e lê
// o que o hook entrega à tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resposta: {} as Record<string, unknown>,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => h.rpc(...a),
    from: () => {
      throw new Error("este teste só anda pelo caminho admin/rpc");
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
    removeChannel: () => {},
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-ficticio" },
    isAdmin: true,
    adminStatus: "admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/admin_cache", () => ({
  lerGeracaoDosCachesDeAdmin: () => 0,
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));

const { useReviews } = await import("@/hooks/useReviews");

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Retorno = Awaited<
  ReturnType<ReturnType<typeof useReviews>["getAllReviews"]>
>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let retorno: Retorno;

function Sonda({
  filtros,
}: {
  filtros?: Parameters<ReturnType<typeof useReviews>["getAllReviews"]>[2];
}) {
  const { getAllReviews } = useReviews();
  return (
    <button
      type="button"
      onClick={async () => {
        retorno = await getAllReviews(0, 20, filtros);
      }}
    >
      puxar
    </button>
  );
}

async function puxar(
  filtros?: Parameters<ReturnType<typeof useReviews>["getAllReviews"]>[2],
) {
  await act(async () => {
    raiz.render(<Sonda filtros={filtros} />);
  });
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation(async () => ({ data: h.resposta, error: null }));
  retorno = undefined;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("useReviews (painel) — linha incompleta da RPC", () => {
  it("autor e produto apagados, sem situação, sem voto e sem comentário: a tela recebe os valores padrão", async () => {
    h.resposta = {
      data: [
        {
          id: "r-antiga",
          product_id: "p-1",
          user_id: "u-1",
          rating: 4,
          created_at: "2026-10-01T12:00:00Z",
          // sem user, product, comment, verified, status, helpful, merchant_reply
        },
      ],
      total_count: 1,
    };
    await puxar();

    const [linha] = retorno!.reviews;
    expect(linha.customerName).toBe("Anônimo");
    expect(linha.productName).toBe("Produto removido");
    expect(linha.comment).toBe("");
    expect(linha.verified).toBe(false);
    // Avaliação antiga (sem situação) já era pública: nunca vai para a fila.
    expect(linha.status).toBe("publicada");
    expect(linha.helpful).toBe(0);
    expect(linha.merchantReply).toBeUndefined();
  });

  it("controle: linha completa passa como veio, sem os padrões por cima", async () => {
    h.resposta = {
      data: [
        {
          id: "r-completa",
          product_id: "p-2",
          user_id: "u-2",
          user: { full_name: "Maria Souza" },
          product: { nome: "Vestido Azul" },
          rating: 5,
          comment: "Chegou rápido",
          verified: true,
          status: "pendente",
          helpful: 7,
          created_at: "2026-10-02T12:00:00Z",
          merchant_reply: "Obrigada!",
        },
      ],
      total_count: 1,
    };
    await puxar();

    const [linha] = retorno!.reviews;
    expect(linha).toMatchObject({
      id: "r-completa",
      productId: "p-2",
      userId: "u-2",
      customerName: "Maria Souza",
      productName: "Vestido Azul",
      rating: 5,
      comment: "Chegou rápido",
      verified: true,
      status: "pendente",
      helpful: 7,
      merchantReply: "Obrigada!",
    });
  });

  it("helpful zero e verificado falso que o banco manda de verdade continuam como vieram", async () => {
    h.resposta = {
      data: [
        {
          id: "r-zero",
          product_id: "p-3",
          user_id: "u-3",
          user: { full_name: "Ana" },
          product: { nome: "Bolsa" },
          rating: 1,
          comment: "Ruim",
          verified: false,
          status: "publicada",
          helpful: 0,
          created_at: "2026-10-03T12:00:00Z",
        },
      ],
      total_count: 1,
    };
    await puxar();

    const [linha] = retorno!.reviews;
    expect(linha.helpful).toBe(0);
    expect(linha.verified).toBe(false);
    expect(linha.status).toBe("publicada");
  });

  it("resposta sem totais (loja vazia): total e média são 0 (número), nunca vazio nem NaN", async () => {
    h.resposta = { data: [] };
    await puxar();

    expect(retorno!.total).toBe(0);
    expect(retorno!.averageRating).toBe(0);
    expect(Number.isNaN(retorno!.averageRating)).toBe(false);
    expect(retorno!.reviews).toEqual([]);
  });

  it("média e total chegam como texto: viram número", async () => {
    h.resposta = { data: [], total_count: 12, average_rating: "4.5" };
    await puxar();

    expect(retorno!.averageRating).toBe(4.5);
    expect(retorno!.total).toBe(12);
  });

  it("sem filtros: pede a RPC com busca vazia e nota 'all'; com nota 5, manda '5' como texto", async () => {
    h.resposta = { data: [] };
    await puxar();
    expect(h.rpc).toHaveBeenLastCalledWith("get_admin_reviews_paged", {
      p_search: "",
      p_rating: "all",
      p_page: 0,
      p_page_size: 20,
    });

    await puxar({ rating: 5, search: "" });
    expect(h.rpc).toHaveBeenLastCalledWith("get_admin_reviews_paged", {
      p_search: "",
      p_rating: "5",
      p_page: 0,
      p_page_size: 20,
    });
  });
});
