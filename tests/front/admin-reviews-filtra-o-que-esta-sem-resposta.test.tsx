// @vitest-environment jsdom
//
// Tela Avaliações: o aviso "avaliação sem resposta" abria a tela em "Todas" (10 por página, as mais novas primeiro).
// Com mais de 10 avaliações chegadas depois, a do aviso ficava na página 2 ou 3 e o aviso mentia. Agora há o filtro
// "Sem resposta (N)" ao lado de "Em moderação" (o molde é o filtro de moderação, de 13/11): o banco filtra a lista E o
// total, o N é a contagem inteira no banco, trocar o filtro volta à página 0, a escolha sobrevive a recarregar a tela
// e o aviso de avaliação publicada sem resposta abre a tela já com ele.
//
// A REGRA de "sem resposta" é a do sino (`@/lib/avaliacoes-para-atender`): o N do chip lê a MESMA constante que a
// bolinha, e o teste confere o texto que chegou à consulta, não a conclusão.
//
// Monta a view de verdade (createRoot + act) com o hook useReviews dublado (casco do teste do filtro de moderação).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    adminReviews: [] as any[],
    pendentesNoBanco: 3 as number | null,
    semRespostaNoBanco: 12 as number | null,
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
  // O que a contagem do chip "Sem resposta" perguntou ao banco: o filtro PostgREST que chegou em `.or`.
  const perguntasDoChip = [] as string[];
  return { estado, getAllReviews, perguntasDoChip };
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
        // contagem da fila de moderação (já existia)
        eq: () =>
          Promise.resolve(
            h.estado.pendentesNoBanco === null
              ? { count: null, error: { message: "falhou" } }
              : { count: h.estado.pendentesNoBanco, error: null },
          ),
        // contagem do chip "Sem resposta"
        or: (filtro: string) => {
          h.perguntasDoChip.push(filtro);
          return Promise.resolve(
            h.estado.semRespostaNoBanco === null
              ? { count: null, error: { message: "falhou" } }
              : { count: h.estado.semRespostaNoBanco, error: null },
          );
        },
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

const SEM_RESPOSTA = {
  id: "r-velha",
  productId: "p-1",
  helpful: 0,
  createdAt: "2026-01-02T12:00:00.000Z",
  productName: "Bobbie Goods",
  customerName: "Gabriel",
  rating: 4,
  comment: "Chegou rápido.",
  verified: true,
  status: "publicada",
};

describe("AdminReviewsView — filtro Sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.adminReviews = [SEM_RESPOSTA];
    h.estado.pendentesNoBanco = 3;
    h.estado.semRespostaNoBanco = 12;
    h.estado.total = 64;
    h.getAllReviews.mockClear();
    h.perguntasDoChip.length = 0;
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
  const botoesDaSituacao = () =>
    Array.from(grupoDeSituacao()?.querySelectorAll("button") ?? []);
  const botao = (inicio: string) =>
    botoesDaSituacao().find((b) =>
      norm(b.textContent).startsWith(inicio),
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

  it("mostra 'Sem resposta' com a contagem INTEIRA do banco, depois de 'Em moderação'; começa em Todas", async () => {
    await montar();
    expect(botoesDaSituacao().map((b) => norm(b.textContent))).toEqual([
      "Todas",
      "Em moderação 3",
      "Sem resposta 12",
    ]);
    expect(botao("Todas").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Sem resposta").getAttribute("aria-pressed")).toBe("false");
    expect(ultimaChamada().filtros.status).toBe("todas");
  });

  it("o N do chip pergunta ao banco pela MESMA regra do sino (a metade 'responder' do filtro dele)", async () => {
    const { FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER } = await import(
      "@/lib/avaliacoes-para-atender"
    );
    await montar();
    expect(h.perguntasDoChip.length).toBeGreaterThan(0);
    for (const filtro of h.perguntasDoChip) {
      // a regra do sino é "sem resposta OU pendente": o chip usa só a primeira metade, a que vem escrita no sino.
      expect(FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER.split(",")).toContain(
        filtro,
      );
      expect(filtro).toBe("merchant_reply.is.null");
    }
  });

  it("tocar em 'Sem resposta' refaz a busca só com elas, volta à página 0 e guarda a escolha", async () => {
    armazem.set("admin_reviews_page", JSON.stringify(2));
    await montar();
    expect(ultimaChamada().pagina).toBe(2);
    await tocar(botao("Sem resposta"));
    const c = ultimaChamada();
    expect(c.filtros.status).toBe("sem_resposta");
    expect(c.pagina).toBe(0);
    expect(botao("Sem resposta").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Em moderação").getAttribute("aria-pressed")).toBe("false");
    expect(armazem.get("admin_reviews_status_filter")).toBe(
      JSON.stringify("sem_resposta"),
    );
    expect(armazem.get("admin_reviews_page")).toBe(JSON.stringify(0));
    // Trocar para 'Em moderação' tira este e liga aquele (um filtro de situação por vez).
    await tocar(botao("Em moderação"));
    expect(ultimaChamada().filtros.status).toBe("pendente");
    expect(botao("Sem resposta").getAttribute("aria-pressed")).toBe("false");
    // E voltar para 'Todas' tira o filtro.
    await tocar(botao("Todas"));
    expect(ultimaChamada().filtros.status).toBe("todas");
  });

  it("o filtro soma com a nota: tocar numa nota depois mantém a situação", async () => {
    await montar();
    await tocar(botao("Sem resposta"));
    const quatro = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "4 estrelas",
    ) as HTMLElement;
    await tocar(quatro);
    const c = ultimaChamada();
    expect(c.filtros.status).toBe("sem_resposta");
    expect(c.filtros.rating).toBe(4);
  });

  it("a escolha sobrevive a recarregar a tela: já abre só com as sem resposta", async () => {
    armazem.set("admin_reviews_status_filter", JSON.stringify("sem_resposta"));
    await montar();
    expect(ultimaChamada().filtros.status).toBe("sem_resposta");
    expect(botao("Sem resposta").getAttribute("aria-pressed")).toBe("true");
  });

  it("sem nenhuma: a lista vazia diz 'Nenhuma avaliação sem resposta' e 'Ver todas' desliga o filtro", async () => {
    h.estado.adminReviews = [];
    h.estado.semRespostaNoBanco = 0;
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("sem_resposta"));
    await montar();
    expect(tela()).toContain("Nenhuma avaliação sem resposta");
    expect(tela()).not.toContain("Sem avaliações ainda");
    expect(tela()).not.toContain("Nenhuma avaliação encontrada");
    expect(tela()).not.toContain("Nenhuma avaliação em moderação");
    expect(norm(botao("Sem resposta").textContent)).toBe("Sem resposta 0");
    const ver = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => norm(b.textContent) === "Ver todas as avaliações",
    ) as HTMLElement;
    await tocar(ver);
    expect(ultimaChamada().filtros.status).toBe("todas");
    expect(ultimaChamada().pagina).toBe(0);
  });

  it("sem resposta vazia COM nota: cai na mensagem de busca (não promete que está tudo respondido)", async () => {
    h.estado.adminReviews = [];
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("sem_resposta"));
    armazem.set("admin_reviews_rating_filter", JSON.stringify(1));
    await montar();
    expect(tela()).toContain("Nenhuma avaliação encontrada");
    expect(tela()).toContain("Nada sem resposta com essa busca ou essa nota");
    expect(tela()).not.toContain("Nenhuma avaliação sem resposta");
  });

  it("'Limpar busca e filtros' também desliga o filtro de sem resposta", async () => {
    h.estado.adminReviews = [];
    h.estado.total = 0;
    armazem.set("admin_reviews_status_filter", JSON.stringify("sem_resposta"));
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

  it("não conseguiu contar: o chip mostra '—', nunca zero confiante, e o de moderação segue com o dele", async () => {
    h.estado.semRespostaNoBanco = null;
    await montar();
    expect(norm(botao("Sem resposta").textContent)).toBe("Sem resposta —");
    expect(norm(botao("Em moderação").textContent)).toBe("Em moderação 3");
  });

  it("a contagem da fila de moderação que falha não leva o chip junto", async () => {
    h.estado.pendentesNoBanco = null;
    await montar();
    expect(norm(botao("Em moderação").textContent)).toBe("Em moderação —");
    expect(norm(botao("Sem resposta").textContent)).toBe("Sem resposta 12");
  });

  it("valor guardado que o app não conhece (aparelho de versão antiga ou lixo) vale 'Todas', nunca erro", async () => {
    armazem.set("admin_reviews_status_filter", JSON.stringify("qualquer"));
    await montar();
    expect(ultimaChamada().filtros.status).toBe("todas");
    expect(botao("Todas").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("o aviso de avaliação sem resposta abre a tela já com o filtro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.adminReviews = [SEM_RESPOSTA];
    h.estado.pendentesNoBanco = 3;
    h.estado.semRespostaNoBanco = 12;
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
  const guardar = (chave: string, valor: unknown) =>
    armazem.set(chave, JSON.stringify(valor));
  const guardado = (chave: string) => JSON.parse(armazem.get(chave) ?? "null");
  const ultimaChamada = () =>
    (h.getAllReviews.mock.calls.at(-1) as unknown[])[2] as {
      status?: string;
      rating?: unknown;
      search?: string;
    };

  it("tela já aberta em segundo plano: zera nota, busca e página e deixa só 'Sem resposta'", async () => {
    guardar("admin_reviews_rating_filter", 2);
    guardar("admin_reviews_status_filter", "pendente");
    guardar("admin_reviews_search_query", "caneta");
    guardar("admin_reviews_page", 3);
    await montar();
    const { limparGuardadosAoChegarPorAviso } = await import(
      "@/utils/chegada-por-aviso"
    );
    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-reviews", {
        soSemResposta: true,
      });
      await esperar();
    });
    expect(guardado("admin_reviews_rating_filter")).toBe("all");
    expect(guardado("admin_reviews_status_filter")).toBe("sem_resposta");
    expect(guardado("admin_reviews_search_query")).toBe("");
    expect(guardado("admin_reviews_page")).toBe(0);
    expect(ultimaChamada()).toMatchObject({
      rating: "all",
      search: "",
      status: "sem_resposta",
    });
  });

  it("tela ainda por abrir: abre já em 'Sem resposta', sem a busca e a página que estavam guardadas", async () => {
    guardar("admin_reviews_status_filter", "todas");
    guardar("admin_reviews_search_query", "caneta");
    guardar("admin_reviews_page", 3);
    const { limparGuardadosAoChegarPorAviso } = await import(
      "@/utils/chegada-por-aviso"
    );
    limparGuardadosAoChegarPorAviso("admin-reviews", { soSemResposta: true });
    await montar();
    const primeira = (h.getAllReviews.mock.calls[0] as unknown[])[2];
    expect(primeira).toMatchObject({ search: "", status: "sem_resposta" });
    expect((h.getAllReviews.mock.calls[0] as unknown[])[0]).toBe(0);
  });

  it("aviso comum e aviso de moderação continuam como eram", async () => {
    guardar("admin_reviews_status_filter", "sem_resposta");
    const { limparGuardadosAoChegarPorAviso } = await import(
      "@/utils/chegada-por-aviso"
    );
    limparGuardadosAoChegarPorAviso("admin-reviews");
    await montar();
    expect((h.getAllReviews.mock.calls[0] as unknown[])[2]).toMatchObject({
      status: "todas",
    });
    h.getAllReviews.mockClear();
    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-reviews", { soEmModeracao: true });
      await esperar();
    });
    expect(ultimaChamada().status).toBe("pendente");
  });
});
