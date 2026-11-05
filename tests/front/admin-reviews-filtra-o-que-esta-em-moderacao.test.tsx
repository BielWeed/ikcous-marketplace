// @vitest-environment jsdom
//
// Tela Avaliações: o topo diz "N para aprovar", mas a lista só filtrava por nota e ordenava por data — com mais de 10
// avaliações uma pendente antiga afundava na paginação e a lojista paginava procurando o selo "Em moderação". Agora há
// o filtro "Em moderação (N)" ao lado do filtro de nota (o modelo é a aba Pendentes de Perguntas): o banco filtra a
// lista E o total, o N é a fila inteira (a mesma do cartão), trocar o filtro volta à página 0, o filtro sobrevive a
// recarregar a tela e o estado vazio diz "Nenhuma avaliação em moderação".
//
// Monta a view de verdade (createRoot + act) com o hook useReviews dublado (casco de avaliacoes-redesenho.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    adminReviews: [] as any[],
    pendentesNoBanco: 3 as number | null,
    total: 64,
  };
  const getAllReviews = vi.fn(async (..._a: unknown[]) => ({
    total: estado.total,
    averageRating: 4.7,
    globalVerifiedCount: 10,
    globalRepliedCount: 6,
    globalTotal: 64,
    globalAverageRating: 4.7,
    globaisDisponiveis: true,
  }));
  return { estado, getAllReviews };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.adminReviews,
    loading: false,
    erroDaListagemAdmin: null,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn(async () => true),
    aprovarReview: vi.fn(async () => true),
    addMerchantReply: vi.fn(async () => true),
    subscribeToReviews: () => () => {},
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve(
            h.estado.pendentesNoBanco === null
              ? { count: null, error: { message: "falhou" } }
              : { count: h.estado.pendentesNoBanco, error: null },
          ),
      }),
    }),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(async () => true),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

const PENDENTE_ANTIGA = {
  id: "r-velha",
  productId: "p-1",
  helpful: 0,
  createdAt: "2026-01-02T12:00:00.000Z",
  productName: "Bobbie Goods",
  customerName: "Gabriel",
  rating: 4,
  comment: "Chegou rápido.",
  verified: true,
  status: "pendente",
};

describe("AdminReviewsView — filtro Em moderação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.adminReviews = [PENDENTE_ANTIGA];
    h.estado.pendentesNoBanco = 3;
    h.estado.total = 64;
    h.getAllReviews.mockClear();
    armazem.clear();
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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
  });

  async function montar() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  const norm = (t: string | null | undefined) =>
    (t ?? "").replace(/\s+/g, " ").trim();
  const tela = () => norm(hospedeiro.textContent);
  const grupoDeSituacao = () =>
    hospedeiro.querySelector(
      '[role="group"][aria-label="Filtrar por situação"]',
    );
  const botaoEmModeracao = () =>
    Array.from(grupoDeSituacao()?.querySelectorAll("button") ?? []).find((b) =>
      norm(b.textContent).startsWith("Em moderação"),
    ) as HTMLButtonElement;
  const botaoTodasDaSituacao = () =>
    Array.from(grupoDeSituacao()?.querySelectorAll("button") ?? []).find(
      (b) => norm(b.textContent) === "Todas",
    ) as HTMLButtonElement;
  async function tocar(el: HTMLElement) {
    await act(async () => {
      el.click();
      await esperar();
    });
  }
  const ultimaChamada = () => {
    const c = h.getAllReviews.mock.calls.at(-1) as [
      number,
      number,
      { status?: string; rating?: unknown; search?: string },
    ];
    return { pagina: c[0], tamanho: c[1], filtros: c[2] };
  };

  it("mostra 'Todas' e 'Em moderação' com a fila INTEIRA do banco; começa em Todas, sem filtro de situação", async () => {
    await montar();
    expect(grupoDeSituacao()).not.toBeNull();
    expect(norm(botaoEmModeracao().textContent)).toBe("Em moderação 3");
    expect(botaoTodasDaSituacao().getAttribute("aria-pressed")).toBe("true");
    expect(botaoEmModeracao().getAttribute("aria-pressed")).toBe("false");
    expect(ultimaChamada().filtros.status).toBe("todas");
  });

  it("o filtro de nota continua sendo o PRIMEIRO grupo da tela (o de situação vem depois)", async () => {
    await montar();
    const grupos = Array.from(
      hospedeiro.querySelectorAll('[role="group"][aria-label]'),
    ).map((g) => g.getAttribute("aria-label"));
    expect(grupos).toEqual(["Filtrar por nota", "Filtrar por situação"]);
  });

  it("tocar em 'Em moderação' refaz a busca só com a fila, volta à página 0 e guarda a escolha", async () => {
    armazem.set("admin_reviews_page", JSON.stringify(2));
    await montar();
    expect(ultimaChamada().pagina).toBe(2);
    await tocar(botaoEmModeracao());
    const c = ultimaChamada();
    expect(c.filtros.status).toBe("pendente");
    expect(c.pagina).toBe(0);
    expect(botaoEmModeracao().getAttribute("aria-pressed")).toBe("true");
    expect(armazem.get("admin_reviews_status_filter")).toBe(
      JSON.stringify("pendente"),
    );
    expect(armazem.get("admin_reviews_page")).toBe(JSON.stringify(0));
    // E voltar para 'Todas' tira o filtro.
    await tocar(botaoTodasDaSituacao());
    expect(ultimaChamada().filtros.status).toBe("todas");
    expect(botaoTodasDaSituacao().getAttribute("aria-pressed")).toBe("true");
  });

  it("o filtro soma com a nota: tocar numa nota depois mantém a situação", async () => {
    await montar();
    await tocar(botaoEmModeracao());
    const quatro = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "4 estrelas",
    ) as HTMLElement;
    await tocar(quatro);
    const c = ultimaChamada();
    expect(c.filtros.status).toBe("pendente");
    expect(c.filtros.rating).toBe(4);
  });

  it("a escolha sobrevive a recarregar a tela: já abre só com a fila", async () => {
    armazem.set("admin_reviews_status_filter", JSON.stringify("pendente"));
    await montar();
    expect(ultimaChamada().filtros.status).toBe("pendente");
    expect(botaoEmModeracao().getAttribute("aria-pressed")).toBe("true");
  });

  it("sem pendente: a lista vazia diz 'Nenhuma avaliação em moderação' e 'Ver todas' desliga o filtro", async () => {
    h.estado.adminReviews = [];
    h.estado.pendentesNoBanco = 0;
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("pendente"));
    await montar();
    expect(tela()).toContain("Nenhuma avaliação em moderação");
    expect(tela()).not.toContain("Sem avaliações ainda");
    expect(tela()).not.toContain("Nenhuma avaliação encontrada");
    expect(norm(botaoEmModeracao().textContent)).toBe("Em moderação 0");
    const ver = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => norm(b.textContent) === "Ver todas as avaliações",
    ) as HTMLElement;
    await tocar(ver);
    expect(ultimaChamada().filtros.status).toBe("todas");
    expect(ultimaChamada().pagina).toBe(0);
  });

  it("fila vazia COM nota: cai na mensagem de busca (não promete que a fila está limpa)", async () => {
    h.estado.adminReviews = [];
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("pendente"));
    armazem.set("admin_reviews_rating_filter", JSON.stringify(1));
    await montar();
    expect(tela()).toContain("Nenhuma avaliação encontrada");
    expect(tela()).toContain("Nada em moderação com essa busca ou essa nota");
    expect(tela()).not.toContain("Nenhuma avaliação em moderação");
  });

  it("'Limpar busca e filtros' também desliga o filtro de situação", async () => {
    h.estado.adminReviews = [];
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("pendente"));
    armazem.set("admin_reviews_rating_filter", JSON.stringify(1));
    await montar();
    const limpar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => norm(b.textContent) === "Limpar busca e filtros",
    ) as HTMLElement;
    await tocar(limpar);
    const c = ultimaChamada();
    expect(c.filtros.status).toBe("todas");
    expect(c.filtros.rating).toBe("all");
  });

  it("não conseguiu contar a fila: o botão mostra '—', nunca zero confiante", async () => {
    h.estado.pendentesNoBanco = null;
    await montar();
    expect(norm(botaoEmModeracao().textContent)).toBe("Em moderação —");
  });
});
