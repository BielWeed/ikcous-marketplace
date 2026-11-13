// @vitest-environment jsdom
//
// A LISTA de Avaliações do painel não pode ficar "carregando" para sempre. Rede
// "pendurada" conecta e não responde: a RPC `get_admin_reviews_paged` ficava
// sem prazo (as ESCRITAS do mesmo hook já tinham `aguardarComPrazo`), o
// `loading` ficava ligado e a tela nunca chegava ao "Tentar de novo".
//
// Roda o hook de verdade com a RPC dublada pendurada e relógio falso: o prazo
// estoura, a leitura cai no estado de erro que já existe (`erroDaListagemAdmin`)
// e o `loading` desliga. Na releitura de bastidor (silent) a lista que já está
// na tela continua utilizável.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastErro: vi.fn(),
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
  toast: { error: h.toastErro, success: vi.fn() },
}));

vi.mock("@/utils/admin_cache", () => ({
  lerGeracaoDosCachesDeAdmin: () => 0,
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));

const { useReviews } = await import("@/hooks/useReviews");

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Sonda = ReturnType<typeof useReviews>;

const LINHA = {
  id: "r-1",
  product_id: "prod-1",
  user_id: "cliente-1",
  rating: 5,
  comment: "Lindo",
  verified: true,
  status: "publicada",
  helpful: 0,
  created_at: "2026-11-01T10:00:00.000Z",
  user: { full_name: "Maria" },
  product: { nome: "Produto Teste" },
};

const respostaBoa = () =>
  Promise.resolve({
    data: {
      data: [LINHA],
      total_count: 1,
      average_rating: 5,
      global_total_count: 1,
      global_average_rating: 5,
      global_total_verified: 1,
      global_total_replied: 0,
    },
    error: null,
  });
const pendurada = () => new Promise<never>(() => {});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let atual: Sonda;

beforeEach(() => {
  vi.useFakeTimers();
  h.rpc.mockReset();
  h.toastErro.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function montar() {
  function Componente() {
    const r = useReviews();
    useEffect(() => {
      atual = r;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Componente />);
  });
}

describe("useReviews (painel) — a leitura da lista tem prazo", () => {
  it("rede que não responde: passado o prazo o loading desliga e o erro 'Tentar de novo' aparece", async () => {
    await montar();
    h.rpc.mockImplementation(pendurada);

    let terminou = false;
    await act(async () => {
      void atual
        .getAllReviews(0, 20, { rating: "all", search: "" })
        .then(() => {
          terminou = true;
        });
    });
    expect(atual.loading).toBe(true);
    expect(terminou).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 1);
    });

    expect(terminou).toBe(true);
    expect(atual.loading).toBe(false);
    expect(atual.erroDaListagemAdmin).toEqual(expect.any(String));
    expect(atual.erroDaListagemAdmin).not.toBe("");
    expect(atual.adminReviews).toEqual([]);
    expect(h.toastErro).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: resposta dentro do prazo continua entregando a lista, sem erro", async () => {
    await montar();
    h.rpc.mockImplementation(respostaBoa);

    await act(async () => {
      await atual.getAllReviews(0, 20, { rating: "all", search: "" });
    });

    expect(atual.loading).toBe(false);
    expect(atual.erroDaListagemAdmin).toBeNull();
    expect(atual.adminReviews).toHaveLength(1);
  });

  it("releitura de bastidor que estoura o prazo mantém a lista que já está na tela, sem erro nem toast", async () => {
    await montar();
    h.rpc.mockImplementation(respostaBoa);
    await act(async () => {
      await atual.getAllReviews(0, 20, { rating: "all", search: "" });
    });
    expect(atual.adminReviews).toHaveLength(1);

    h.rpc.mockImplementation(pendurada);
    let terminou = false;
    await act(async () => {
      void atual
        .getAllReviews(0, 20, { rating: "all", search: "", silent: true })
        .then(() => {
          terminou = true;
        });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 1);
    });

    expect(terminou).toBe(true);
    expect(atual.loading).toBe(false);
    expect(atual.adminReviews).toHaveLength(1);
    expect(atual.erroDaListagemAdmin).toBeNull();
    expect(h.toastErro).not.toHaveBeenCalled();
  });
});
