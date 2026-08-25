// @vitest-environment jsdom
//
// KPIs de Avaliações "Global"/"no total" NÃO seguem o filtro (achado 5 da
// auditoria, degrau 1; par RPC 20261002000000 + front).
//
// O defeito: as quatro métricas vinham do mesmo WHERE do filtro — cartões
// escritos "Global"/"no total" mudavam com o filtro, e filtro vazio
// mostrava "100%" com "0 no total" na mesma caixa.
//
// Este teste é a metade FRONT do par: com a RPC devolvendo um resultado
// FILTRADO VAZIO (total_count=0) e GLOBAIS POVOADOS (global_total=7,
// média 4.4, 3 verificadas, 2 respondidas), os cartões têm que mostrar os
// GLOBAIS — inclusive "43%" de verificadas (3/7), nunca "100%" de zero.
// A corrida vermelha deste teste contra o código antigo é a prova de
// sabotagem do par.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminReviewsView } from "@/views/admin/AdminReviewsView";

// Dublê do supabase (mesmo encadeável dos testes vizinhos): a view puxa o
// cliente real na importação e o jsdom não tem Web Worker para o realtime.
function construtorEncadeavel() {
  const alvo: any = () => construtorEncadeavel();
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: null });
      }
      return () => construtorEncadeavel();
    },
    apply: () => construtorEncadeavel(),
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel(),
    rpc: () => construtorEncadeavel(),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
    removeChannel: () => {},
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn().mockResolvedValue(true),
  }),
}));

// Estado COMPARTILHADO (o vizinho avaliacoes-sem-dado usa o mesmo padrão):
// a factory cria novo vi.fn a cada chamada do hook — mockResolvedValueOnce
// numa instância não afeta a que o componente usa. O dublê lê este objeto.
const h = vi.hoisted(() => ({
  retorno: {
    reviews: [] as unknown[],
    total: 0,
    averageRating: 0,
    // Filtro vazio; globais de verdade povoados (7 no total, média 4.4,
    // 3 verificadas = 43%, 2 respondidas).
    globalVerifiedCount: 3,
    globalRepliedCount: 2,
    globalTotal: 7,
    globalAverageRating: 4.4,
    globaisDisponiveis: true,
  },
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: false,
    getAllReviews: vi.fn(async () => h.retorno),
    deleteReview: vi.fn(),
    toggleVerified: vi.fn(),
    addMerchantReply: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "user",
    loading: false,
    isPasswordRecovery: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function stubsDeBrowser() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  stubsDeBrowser();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("KPIs globais de Avaliações (par com a migration 20261002000000)", () => {
  it("filtro vazio: cartões mostram os GLOBAIS — 4.4, 7, e 43% (nunca 100% de zero)", async () => {
    await act(async () => {
      raiz.render(
        <AdminReviewsView active={true} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texto = hospedeiro.textContent ?? "";

    // Média Global e Total Recebido: os globais, não os do filtro (0).
    expect(texto).toContain("4.4");
    expect(texto).toContain("7");

    // A armadilha do achado: "100%" com zero no total. 3 de 7 = 43%.
    expect(texto).not.toContain("100%");
    expect(texto).toContain("43%");
  });

  it("CORRIGE 1 da 2305: nenhum elemento rotulado 'global' mostra o filtrado — o badge do topo incluso", async () => {
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // O badge sticky cujo title promete "Média global de estrelas" tem que
    // mostrar o GLOBAL (4.4) — nunca o filtrado (0.0 do dublê).
    const badge = hospedeiro.querySelector(
      '[title="Média global de estrelas"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("4.4");
    expect(badge!.textContent).not.toContain("0.0");
  });

  it("CORRIGE 2 da 2305: RPC antiga (sem chaves global_*) com lista cheia — cartões mostram '—', nunca zero", async () => {
    // A RPC ANTIGA em ação: lista cheia (43 no total filtrado) e NENHUMA
    // chave global_* — nem globaisDisponiveis.
    const anterior = h.retorno;
    h.retorno = {
      ...anterior,
      reviews: [{ id: "r1" }, { id: "r2" }],
      total: 43,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
      globalTotal: 0,
      globalAverageRating: 0,
      globaisDisponiveis: false,
    };

    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texto = hospedeiro.textContent ?? "";
    // "—" nos cartões globais — zero antes do apply é indistinguível de
    // loja vazia, e a lista embaixo tem 43.
    expect(texto).toContain("—");
    expect(texto).not.toContain("0.0");
    h.retorno = anterior;
  });
});
