// @vitest-environment jsdom
//
// O filtro "Sem resposta" da tela Avaliações (migration 20261399996000) chega ao banco: `getAllReviews` do hook
// manda `p_status: "sem_resposta"` para get_admin_reviews_paged SÓ quando o filtro está ligado (o de moderação segue
// mandando "pendente"). Sem filtro a lista continua chamando com os 4 parâmetros de sempre — assim a loja que ainda não
// recebeu a migration segue abrindo a tela, e a chamada sem filtro não depende do banco novo.
// Roda o hook de verdade com o `supabase.rpc` dublado e lê o que ele recebeu (entrada, nunca a conclusão).
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

type Filtros = Parameters<ReturnType<typeof useReviews>["getAllReviews"]>[2];

let raiz: Root;
let hospedeiro: HTMLDivElement;
let pedido: { pagina: number; filtros: Filtros } = {
  pagina: 0,
  filtros: undefined,
};

function Sonda() {
  const { getAllReviews } = useReviews();
  return (
    <button
      type="button"
      onClick={async () => {
        await getAllReviews(pedido.pagina, 20, pedido.filtros);
      }}
    >
      puxar
    </button>
  );
}

async function puxar(pagina: number, filtros: Filtros) {
  pedido = { pagina, filtros };
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
}

const argumentosDaUltimaChamada = () => {
  const chamada = h.rpc.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(chamada[0]).toBe("get_admin_reviews_paged");
  return chamada[1];
};

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

describe("useReviews — o filtro Sem resposta chega à get_admin_reviews_paged", () => {
  it("status 'sem_resposta' manda p_status 'sem_resposta' junto da busca, da nota e da página", async () => {
    await puxar(3, { rating: 4, search: "ana", status: "sem_resposta" });
    expect(argumentosDaUltimaChamada()).toEqual({
      p_search: "ana",
      p_rating: "4",
      p_page: 3,
      p_page_size: 20,
      p_status: "sem_resposta",
    });
  });

  it("o filtro de moderação continua mandando 'pendente' (os dois não se misturam)", async () => {
    await puxar(0, { rating: "all", search: "", status: "pendente" });
    expect(argumentosDaUltimaChamada()).toEqual({
      p_search: "",
      p_rating: "all",
      p_page: 0,
      p_page_size: 20,
      p_status: "pendente",
    });
  });

  it("status 'todas' ou ausente NÃO manda p_status: a chamada é a de 4 parâmetros de sempre", async () => {
    await puxar(0, { rating: "all", search: "", status: "todas" });
    expect("p_status" in argumentosDaUltimaChamada()).toBe(false);
    await puxar(0, { rating: "all", search: "" });
    expect("p_status" in argumentosDaUltimaChamada()).toBe(false);
    await puxar(0, undefined);
    expect("p_status" in argumentosDaUltimaChamada()).toBe(false);
  });

  it("o total devolvido é o das sem resposta (o paginador segue o filtro) e os globais seguem os globais", async () => {
    h.rpc.mockResolvedValueOnce({
      data: {
        data: [],
        total_count: 12,
        average_rating: 4,
        global_total_count: 64,
        global_average_rating: 4.4,
        global_total_verified: 30,
        global_total_replied: 20,
      },
      error: null,
    });
    let resultado: Record<string, unknown> | undefined;
    function SondaComResultado() {
      const { getAllReviews } = useReviews();
      return (
        <button
          type="button"
          onClick={async () => {
            resultado = (await getAllReviews(0, 20, {
              status: "sem_resposta",
            })) as Record<string, unknown>;
          }}
        >
          puxar
        </button>
      );
    }
    await act(async () => {
      raiz.render(<SondaComResultado />);
    });
    await act(async () => {
      hospedeiro.querySelector("button")?.click();
    });
    expect(resultado?.total).toBe(12);
    expect(resultado?.globalTotal).toBe(64);
  });
});
