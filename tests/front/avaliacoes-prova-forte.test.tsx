// @vitest-environment jsdom
//
// Prova forte da tela Avaliações do painel (25/11/2026, caça por mutação).
// Defeitos de uma linha que os testes vizinhos deixavam passar, cada um
// derrubado por um teste daqui:
//   - o contador "acharam útil" só aparece com voto (zero some);
//   - só a nota 1 ou 2 fica vermelha (a 3 não);
//   - avaliação sem comentário diz "Avaliação só com estrelas.";
//   - o botão Aprovar fica desabilitado sem internet;
//   - cada resposta rápida entra com o texto inteiro e a seguinte vai ao fim,
//     separada por um espaço, sem apagar o que a lojista já digitou.
// Monta a view de verdade com o hook useReviews dublado (mesmo molde do
// avaliacoes-redesenho). Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    adminReviews: [] as any[],
    offline: false,
  };
  const getAllReviews = vi.fn(async (..._a: unknown[]) => ({
    total: estado.adminReviews.length,
    averageRating: 4,
    globalVerifiedCount: 1,
    globalRepliedCount: 1,
    globalTotal: 3,
    globalAverageRating: 4,
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
        eq: () => Promise.resolve({ count: 0, error: null }),
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

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.estado.offline,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

const base = {
  productId: "p-1",
  helpful: 0,
  createdAt: "2026-07-07T12:00:00.000Z",
  verified: false,
  status: "publicada",
};

const SUPORTE =
  "Olá! Lamentamos muito que sua experiência não tenha sido ideal. Já estamos cientes do seu relato e entraremos em contato via WhatsApp para resolver isso o quanto antes.";
const POSITIVA =
  "Que excelente notícia! Ficamos muito satisfeitos em saber que o produto atendeu suas expectativas. Conte sempre conosco!";
const ESCLARECER =
  "Agradecemos o seu comentário. Gostaríamos de ressaltar que as instruções de uso estão no manual do produto. Qualquer dúvida adicional, estamos à disposição no suporte.";
const AGRADECER =
  "Muito obrigado pela sua avaliação! Avaliações como a sua nos motivam a continuar oferecendo a melhor qualidade.";

describe("AdminReviewsView — prova forte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.adminReviews = [];
    h.estado.offline = false;
    h.getAllReviews.mockClear();
    armazem.clear();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
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
    armazem.clear();
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
  const porRotulo = (rotulo: string) =>
    document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${rotulo}"]`,
    );
  const doCartao = (nome: string) =>
    [...hospedeiro.querySelectorAll("li")].find((li) =>
      li.textContent?.includes(nome),
    ) as HTMLLIElement;

  async function tocar(el: HTMLElement | null | undefined) {
    if (!el) throw new Error("elemento não encontrado");
    await act(async () => {
      el.click();
      await esperar();
    });
  }
  async function digitar(campo: HTMLTextAreaElement, texto: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await esperar();
    });
  }

  it("'acharam útil' só aparece em quem teve voto, e mostra o número", async () => {
    h.estado.adminReviews = [
      {
        ...base,
        id: "r-1",
        customerName: "Ana Sem Voto",
        rating: 5,
        comment: "Ótimo",
      },
      {
        ...base,
        id: "r-2",
        customerName: "Bia Com Voto",
        rating: 5,
        comment: "Muito bom",
        helpful: 3,
      },
    ];
    await montar();

    const selo = '[title="Clientes que acharam esta avaliação útil"]';
    expect(doCartao("Ana Sem Voto").querySelector(selo)).toBeNull();
    const dela = doCartao("Bia Com Voto").querySelector(selo);
    expect(norm(dela?.querySelector(".tabular-nums")?.textContent)).toBe("3");
    expect(norm(dela?.querySelector(".sr-only")?.textContent)).toBe(
      "acharam útil",
    );
    expect(hospedeiro.querySelectorAll(selo)).toHaveLength(1);
  });

  it("só a nota 1 ou 2 fica vermelha; a 3 continua neutra", async () => {
    h.estado.adminReviews = [
      {
        ...base,
        id: "r-1",
        customerName: "Nota Dois",
        rating: 2,
        comment: "Fraco",
      },
      {
        ...base,
        id: "r-2",
        customerName: "Nota Tres",
        rating: 3,
        comment: "Regular",
      },
    ];
    await montar();

    const cheias = (nome: string, nota: number) =>
      [
        ...doCartao(nome).querySelectorAll(
          `[role="img"][aria-label="Nota ${nota} de 5"] svg`,
        ),
      ].filter((s) => s.getAttribute("class")?.includes("fill-current"));

    const dois = cheias("Nota Dois", 2);
    const tres = cheias("Nota Tres", 3);
    expect(dois).toHaveLength(2);
    expect(tres).toHaveLength(3);
    for (const estrela of dois) {
      expect(estrela.getAttribute("class")).not.toContain("text-zinc-100");
    }
    for (const estrela of tres) {
      expect(estrela.getAttribute("class")).toContain("text-zinc-100");
    }
  });

  it("avaliação sem comentário diz 'Avaliação só com estrelas.'; com comentário mostra o comentário entre aspas", async () => {
    h.estado.adminReviews = [
      {
        ...base,
        id: "r-1",
        customerName: "Só Estrelas",
        rating: 5,
        comment: "",
      },
      {
        ...base,
        id: "r-2",
        customerName: "Com Texto",
        rating: 5,
        comment: "Gostei",
      },
    ];
    await montar();

    expect(
      norm(doCartao("Só Estrelas").querySelector("p.italic")?.textContent),
    ).toBe("Avaliação só com estrelas.");
    expect(
      norm(doCartao("Com Texto").querySelector("p.italic")?.textContent),
    ).toBe("“Gostei”");
  });

  it("Aprovar fica habilitado com internet e desabilitado sem internet", async () => {
    h.estado.adminReviews = [
      {
        ...base,
        id: "r-1",
        customerName: "Na Fila",
        rating: 5,
        comment: "Aguardando",
        status: "pendente",
      },
    ];
    await montar();
    expect(porRotulo("Aprovar e Publicar")?.disabled).toBe(false);

    act(() => raiz.unmount());
    h.estado.offline = true;
    raiz = createRoot(hospedeiro);
    await montar();
    expect(porRotulo("Aprovar e Publicar")).not.toBeNull();
    expect(porRotulo("Aprovar e Publicar")?.disabled).toBe(true);
  });

  it("as quatro respostas rápidas entram inteiras; a seguinte vai ao fim, com um espaço, sem apagar o que já estava", async () => {
    h.estado.adminReviews = [
      {
        ...base,
        id: "r-1",
        customerName: "Marina",
        rating: 2,
        comment: "Faltou uma folha",
      },
    ];
    await montar();
    await tocar(porRotulo("Responder a Marina"));
    const campo = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Sua resposta"]',
    );
    if (!campo) throw new Error("campo de resposta não abriu");
    const rapida = (rotulo: string) =>
      [...document.body.querySelectorAll("button")].find(
        (b) => norm(b.textContent) === rotulo,
      );

    await tocar(rapida("Agradecer avaliação"));
    expect(campo.value).toBe(AGRADECER);

    await digitar(campo, "");
    await tocar(rapida("Dar suporte"));
    expect(campo.value).toBe(SUPORTE);

    await digitar(campo, "");
    await tocar(rapida("Avaliação positiva"));
    expect(campo.value).toBe(POSITIVA);

    await digitar(campo, "");
    await tocar(rapida("Esclarecer produto"));
    expect(campo.value).toBe(ESCLARECER);

    // O que já estava digitado fica, e a sugestão entra no fim após um espaço.
    await digitar(campo, "Olá, Marina!  ");
    await tocar(rapida("Dar suporte"));
    expect(campo.value).toBe(`Olá, Marina! ${SUPORTE}`);
  });
});
