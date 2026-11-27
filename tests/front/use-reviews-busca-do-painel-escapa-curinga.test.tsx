// @vitest-environment jsdom
//
// A busca da tela Avaliações escapa `%` e `_` antes de ir ao banco. A get_admin_reviews_paged concatena o termo
// em `ILIKE '%' || termo || '%'` (escape padrão `\`, igual às buscas de pedidos e cupons): `_` cru casa qualquer
// letra e `100%` cru casa qualquer coisa que comece com "100". O hook passa o termo por
// `prepararTextoDeBuscaDoPainel`, o mesmo das outras buscas do painel.
// Roda o hook de verdade com o `supabase.rpc` dublado e lê o que ele recebeu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(async (..._a: unknown[]) => ({
    data: {
      data: [],
      total_count: 0,
      average_rating: 0,
      global_total_count: 0,
      global_average_rating: 0,
      global_total_verified: 0,
      global_total_replied: 0,
    },
    error: null,
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
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
  lerGeracaoDosCachesDeAdmin: () => 0,
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));

const { useReviews } = await import("@/hooks/useReviews");

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let termo = "";

function Sonda() {
  const { getAllReviews } = useReviews();
  return (
    <button
      type="button"
      onClick={async () => {
        await getAllReviews(0, 20, { rating: "all", search: termo });
      }}
    >
      puxar
    </button>
  );
}

async function buscar(texto: string): Promise<unknown> {
  termo = texto;
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
  const chamada = h.rpc.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(chamada[0]).toBe("get_admin_reviews_paged");
  return chamada[1].p_search;
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  h.rpc.mockClear();
});

describe("useReviews — a busca do painel escapa os curingas do ILIKE", () => {
  it("buscar `_` não manda o curinga cru", async () => {
    expect(await buscar("_")).toBe("\\_");
  });

  it("buscar `100%` manda o porcento escapado", async () => {
    expect(await buscar("100%")).toBe("100\\%");
  });

  it("texto comum segue igual, e busca vazia segue vazia", async () => {
    expect(await buscar("ana")).toBe("ana");
    expect(await buscar("")).toBe("");
  });
});
