// @vitest-environment jsdom
//
// O MAPEAMENTO do hook (item 3 da revisão final, dobrado no B2): nenhum
// teste executava `useReviews` de verdade — os dublês alimentavam valores
// JÁ mapeados. Trocar `global_total_count` por `total_count` no hook, ou
// a trava `"global_total_count" in rpcData` por `true`, mantinha a suite
// verde. Este teste roda o hook com o `supabase.rpc` dublado devolvendo
// o formato CRU da RPC (entrada, nunca a conclusão) e afirma as duas
// metades: o mapeamento global_* e o SOBREVIVENTE filtrado (o paginador).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado por teste: o que o rpc dublado devolve (formato cru da RPC).
const h = vi.hoisted(() => ({
  respostaRpc: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // Semântica do supabase-js: rpc() resolve {data, error} — o jsonb
    // inteiro vem no data. O mock devolve a embalagem certa.
    rpc: vi.fn(async () => ({ data: h.respostaRpc, error: null })),
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
    user: { id: "u-1" },
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
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));

const { useReviews } = await import("@/hooks/useReviews");

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimoResultado: Record<string, unknown> | null = null;

function Sonda() {
  const { getAllReviews } = useReviews();
  return (
    <button
      onClick={async () => {
        ultimoResultado = (await getAllReviews(0, 20, {
          rating: "all",
          search: "",
          silent: true,
        })) as Record<string, unknown>;
      }}
    >
      puxar
    </button>
  );
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  ultimoResultado = null;
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.clearAllMocks();
});

async function puxar() {
  await act(async () => {
    hospedeiro.querySelector("button")!.click();
  });
}

describe("useReviews — mapeamento da get_admin_reviews_paged (RPC crua)", () => {
  it("RPC NOVA: global_* mapeados, e o FILTRADO sobrevive para o paginador", async () => {
    h.respostaRpc = {
      data: [],
      total_count: 2, // filtrado
      average_rating: 1.0,
      global_total_count: 7, // global
      global_average_rating: 4.4,
      global_total_verified: 3,
      global_total_replied: 2,
    };
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await puxar();

    expect(ultimoResultado).not.toBeNull();
    // Os GLOBAIS vêm das chaves global_* (o mapeamento, não a conclusão).
    expect(ultimoResultado!.globalTotal).toBe(7);
    expect(ultimoResultado!.globalAverageRating).toBe(4.4);
    expect(ultimoResultado!.globalVerifiedCount).toBe(3);
    expect(ultimoResultado!.globalRepliedCount).toBe(2);
    expect(ultimoResultado!.globaisDisponiveis).toBe(true);
    // O SOBREVIVENTE: o paginador continua com o filtrado — é ele que
    // impede a "correção" preguiçosa de globalizar os dois.
    expect(ultimoResultado!.total).toBe(2);
  });

  it("RPC ANTIGA (nenhuma chave global_*): globaisDisponiveis FALSE — nunca zero confiante", async () => {
    h.respostaRpc = {
      data: [{ id: "r1" }, { id: "r2" }],
      total_count: 43,
      average_rating: 4.3,
      // zero chave global_* — a janela pré-apply.
    };
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await puxar();

    expect(ultimoResultado).not.toBeNull();
    // A trava é a PRESENÇA da chave — este é o teste que mata o mutante
    // `substituir "global_total_count" in rpcData por true`.
    expect(ultimoResultado!.globaisDisponiveis).toBe(false);
    // A lista e o paginador seguem vivos.
    expect(ultimoResultado!.total).toBe(43);
    expect(ultimoResultado!.reviews).toHaveLength(2);
  });
});
