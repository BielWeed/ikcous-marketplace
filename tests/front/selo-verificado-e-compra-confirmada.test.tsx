// @vitest-environment jsdom
//
// Item 7 do laudo "o que falta" (29/08, degrau 2): o selo "Verificado" era
// interruptor MANUAL do lojista — significava "alguém clicou", não "compra
// confirmada". E o insert de avaliação é direto do front (RLS só exige ser o
// autor): qualquer logado avalia qualquer produto sem ter comprado.
//
// O conserto (migration 20261030000000) deriva o selo da compra com dinheiro
// reconhecido pelas triggers, e o botão manual "Verificar Compra/Remover
// Verificação" SAI do painel — interruptor voltaria a significar "clicou".
// Este teste monta a AdminReviewsView de verdade (createRoot + act, mesmo
// padrão de avaliacoes-sem-dado-nao-inventa-porcentagem.test.tsx) e crava:
//   * o botão manual não existe mais (nos dois modos de card);
//   * o badge derivado continua lendo a coluna `verified` (verificada mostra,
//     não-verificada não mostra).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reviews que o getAllReviews dublê devolve — uma verificada, uma não.
const h = vi.hoisted(() => {
  const estado = {
    loading: true,
    adminReviews: [] as any[],
  };

  async function getAllReviews() {
    return {
      total: estado.adminReviews.length,
      averageRating: 5,
      globalVerifiedCount: estado.adminReviews.filter((r) => r.verified).length,
      globalRepliedCount: 0,
      globalTotal: estado.adminReviews.length,
      globalAverageRating: 5,
      globaisDisponiveis: true,
    };
  }

  return { estado, getAllReviews };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.adminReviews,
    loading: h.estado.loading,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn(),
    addMerchantReply: vi.fn(),
    subscribeToReviews: () => () => {},
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminReviewsView — o selo Verificado é da compra, não do clique", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.loading = true;
    h.estado.adminReviews = [
      {
        id: "rev-1",
        productId: "prod-1",
        productName: "Produto Teste",
        customerName: "Compradora",
        rating: 5,
        comment: "Adorei!",
        verified: true,
        helpful: 0,
        createdAt: new Date("2026-08-01").toISOString(),
      },
      {
        id: "rev-2",
        productId: "prod-1",
        productName: "Produto Teste",
        customerName: "Visitante",
        rating: 4,
        comment: "Bom",
        verified: false,
        helpful: 0,
        createdAt: new Date("2026-08-02").toISOString(),
      },
    ];

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
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
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    h.estado.loading = false;
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
  }

  it("o botão manual de verificação NÃO existe mais (nem no card detalhado, nem no compacto)", async () => {
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Verificar Compra");
    expect(texto).not.toContain("Remover Verificação");
    // Nenhum botão da tela alterna verificação:
    const botoes = [...hospedeiro.querySelectorAll("button")];
    expect(
      botoes.filter((b) =>
        (b.getAttribute("title") ?? "").includes("Verificação"),
      ),
    ).toHaveLength(0);
  });

  it("o badge derivado continua lendo a coluna verified (verificada mostra, outra não)", async () => {
    await montar();

    const texto = hospedeiro.textContent ?? "";
    // As duas reviews estão na tela:
    expect(texto).toContain("Compradora");
    expect(texto).toContain("Visitante");
    // O badge POR CARD da review verificada (singular — o KPI do topo é o
    // plural "Compras Verificadas"):
    expect(texto).toContain("Compra Verificada");
  });
});
