// @vitest-environment jsdom
//
// Redesenho da tela Avaliações do painel (desenho aprovado pelo dono em
// 22/10/2026): alternador + ajuda, busca, filtro por nota, resumo numa linha
// ("★ 4,7 · 12 avaliações · 2 na fila") que expande em quatro cartões,
// interruptor "Mostrar avaliações na loja", cartões neutros (cor só para
// estado e nota baixa), aprovar/responder/excluir dentro do cartão.
//
// Monta a view de verdade (createRoot + act) com o hook useReviews dublado.
// A honestidade dos números (global não segue o filtro, "—" sem dado) fica em
// kpis-globais-de-avaliacoes-nao-seguem-o-filtro e
// avaliacoes-sem-dado-nao-inventa-porcentagem.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    loading: false,
    adminReviews: [] as any[],
    pendentesNoBanco: 2,
    erro: null as string | null,
    offline: false,
    enableReviews: true,
  };
  const aprovarReview = vi.fn(async (..._a: unknown[]) => {});
  const addMerchantReply = vi.fn(async (..._a: unknown[]) => true);
  const deleteReview = vi.fn(async (..._a: unknown[]) => true);
  const updateConfig = vi.fn(async (..._a: unknown[]) => true);
  const getAllReviews = vi.fn(async (..._a: unknown[]) => ({
    total: estado.adminReviews.length,
    averageRating: 4.7,
    globalVerifiedCount: 10,
    globalRepliedCount: 6,
    globalTotal: 12,
    globalAverageRating: 4.7,
    globaisDisponiveis: true,
  }));
  return {
    estado,
    aprovarReview,
    addMerchantReply,
    deleteReview,
    updateConfig,
    getAllReviews,
  };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.adminReviews,
    loading: h.estado.loading,
    erroDaListagemAdmin: h.estado.erro,
    getAllReviews: h.getAllReviews,
    deleteReview: h.deleteReview,
    aprovarReview: h.aprovarReview,
    addMerchantReply: h.addMerchantReply,
    subscribeToReviews: () => () => {},
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({ count: h.estado.pendentesNoBanco, error: null }),
      }),
    }),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: h.estado.enableReviews },
    isLoaded: true,
    updateConfig: h.updateConfig,
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
};
const PUBLICADA = {
  ...base,
  id: "r-1",
  productName: "caneta 3d",
  customerName: "Isadora Bernardes",
  rating: 5,
  comment: "Eu amei",
  verified: true,
  status: "publicada",
};
const PENDENTE = {
  ...base,
  id: "r-2",
  productName: "Bobbie Goods",
  customerName: "Gabriel",
  rating: 4,
  comment: "Chegou rápido e bem embalado.",
  verified: true,
  status: "pendente",
};
const RUIM_RESPONDIDA = {
  ...base,
  id: "r-3",
  productName: "Bobbie Goods",
  customerName: "Marina",
  rating: 2,
  comment: "Veio faltando uma folha.",
  verified: false,
  status: "publicada",
  merchantReply: "Olá, Marina! Vamos mandar a folha que faltou.",
};

describe("AdminReviewsView — redesenho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.loading = false;
    h.estado.adminReviews = [PUBLICADA, PENDENTE, RUIM_RESPONDIDA];
    h.estado.pendentesNoBanco = 2;
    h.estado.erro = null;
    h.estado.offline = false;
    h.estado.enableReviews = true;
    for (const f of [
      h.aprovarReview,
      h.addMerchantReply,
      h.deleteReview,
      h.updateConfig,
      h.getAllReviews,
    ]) {
      f.mockClear();
    }
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
  function botoes(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll("button"));
  }
  function botaoPorTexto(texto: string, indice = 0): HTMLButtonElement {
    const achados = botoes().filter((b) => norm(b.textContent) === texto);
    if (!achados[indice]) {
      throw new Error(
        `não achei o botão "${texto}"; há: ${botoes()
          .map((b) => norm(b.textContent) || b.getAttribute("aria-label"))
          .join(" | ")}`,
      );
    }
    return achados[indice];
  }
  const porRotulo = (rotulo: string) =>
    botoes().filter((b) => b.getAttribute("aria-label") === rotulo);
  async function tocar(el: HTMLElement) {
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

  it("o filtro por nota tem Todas e de 5 a 1 estrelas, e tocar numa nota refaz a busca", async () => {
    await montar();
    const grupo = hospedeiro.querySelector('[role="group"][aria-label]');
    expect(grupo?.getAttribute("aria-label")).toBe("Filtrar por nota");
    const nomes = Array.from(grupo?.querySelectorAll("button") ?? []).map(
      (b) => b.getAttribute("aria-label") ?? norm(b.textContent),
    );
    expect(nomes).toEqual([
      "Todas",
      "5 estrelas",
      "4 estrelas",
      "3 estrelas",
      "2 estrelas",
      "1 estrela",
    ]);
    expect(botaoPorTexto("Todas").getAttribute("aria-pressed")).toBe("true");

    await tocar(porRotulo("4 estrelas")[0] as HTMLElement);
    const chamada = h.getAllReviews.mock.calls.at(-1) as unknown[];
    expect(chamada[0]).toBe(0);
    expect((chamada[2] as { rating: unknown }).rating).toBe(4);
    expect(porRotulo("4 estrelas")[0]?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("o resumo diz a média, o total e a fila numa linha e expande em quatro cartões", async () => {
    await montar();
    const fechado = tela();
    expect(fechado).toContain("4,7");
    expect(fechado).toContain("12 avaliações");
    expect(fechado).toContain("2 na fila");
    expect(fechado).not.toContain("nota dos compradores");

    await tocar(botaoPorTexto("Expandir"));
    const aberto = tela();
    for (const trecho of [
      "Média global",
      "nota dos compradores",
      "Total recebido",
      "2 para aprovar",
      "Taxa de resposta",
      "50%",
      "6 respondidas no total",
      "Compras verificadas",
      "83%",
      "10 verificadas no total",
    ]) {
      expect(aberto, trecho).toContain(trecho);
    }
    await tocar(botaoPorTexto("Recolher"));
    expect(tela()).not.toContain("nota dos compradores");
  });

  it("o interruptor da loja diz Ativo e desliga com um toque", async () => {
    await montar();
    expect(tela()).toContain("Mostrar avaliações na loja");
    expect(tela()).toContain("Ativo");
    const chave = document.body.querySelector<HTMLElement>('[role="switch"]');
    expect(chave?.getAttribute("aria-checked")).toBe("true");
    await tocar(chave as HTMLElement);
    expect(h.updateConfig).toHaveBeenCalledWith({ enableReviews: false });
  });

  it("com as avaliações desligadas o interruptor diz Inativo e explica o que ligar faz", async () => {
    h.estado.enableReviews = false;
    await montar();
    expect(tela()).toContain("Inativo");
    expect(tela()).toContain(
      "Ligue para os clientes verem notas e comentários nas páginas dos produtos.",
    );
  });

  it("cada cartão mostra quem, quando, o produto, a nota e a marca de compra verificada", async () => {
    await montar();
    const t = tela();
    expect(t).toContain("Isadora Bernardes");
    expect(t).toContain("07/07/2026");
    expect(t).toContain("caneta 3d");
    expect(t).toContain("Eu amei");
    expect(t).toContain("Verificada");
    const notas = Array.from(hospedeiro.querySelectorAll('[role="img"]')).map(
      (e) => e.getAttribute("aria-label"),
    );
    expect(notas).toEqual(["Nota 5 de 5", "Nota 4 de 5", "Nota 2 de 5"]);
  });

  it("a avaliação pendente leva 'Em moderação' e o botão Aprovar publica pelo id", async () => {
    await montar();
    expect(tela()).toContain("Em moderação");
    const aprovar = botaoPorTexto("Aprovar");
    expect(aprovar.getAttribute("aria-label")).toBe("Aprovar e Publicar");
    expect(
      botoes().filter((b) => norm(b.textContent) === "Aprovar"),
    ).toHaveLength(1);
    await tocar(aprovar);
    expect(h.aprovarReview).toHaveBeenCalledWith("r-2");
  });

  it("a resposta da loja aparece no cartão respondido, que perde o botão Responder", async () => {
    await montar();
    expect(tela()).toContain("Vamos mandar a folha que faltou.");
    expect(tela()).toContain("Resposta da loja");
    // 3 avaliações, uma já respondida: só duas oferecem Responder.
    expect(
      botoes().filter((b) => norm(b.textContent) === "Responder"),
    ).toHaveLength(2);
  });

  it("Responder abre o formulário no cartão, com respostas rápidas que preenchem o campo", async () => {
    await montar();
    await tocar(botaoPorTexto("Responder", 0));
    expect(tela()).toContain("Resposta rápida");
    for (const nome of [
      "Agradecer feedback",
      "Dar suporte",
      "Feedback positivo",
      "Esclarecer produto",
    ]) {
      expect(botaoPorTexto(nome)).toBeTruthy();
    }
    const publicar = botaoPorTexto("Publicar resposta");
    expect(publicar.disabled).toBe(true);

    await tocar(botaoPorTexto("Agradecer feedback"));
    const campo = hospedeiro.querySelector<HTMLTextAreaElement>("textarea");
    expect(campo?.value).toContain("Muito obrigado pela sua avaliação");
    expect(publicar.disabled).toBe(false);

    await digitar(campo as HTMLTextAreaElement, "Obrigado, Isadora!");
    await tocar(publicar);
    expect(h.addMerchantReply).toHaveBeenCalledWith(
      "r-1",
      "Obrigado, Isadora!",
    );
  });

  it("Cancelar fecha o formulário sem enviar nada", async () => {
    await montar();
    await tocar(botaoPorTexto("Responder", 0));
    expect(hospedeiro.querySelector("textarea")).toBeTruthy();
    await tocar(botaoPorTexto("Cancelar"));
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    expect(h.addMerchantReply).not.toHaveBeenCalled();
  });

  it("excluir pede confirmação em frase e só apaga ao tocar em Excluir", async () => {
    await montar();
    const lixeiras = porRotulo("Excluir avaliação");
    expect(lixeiras).toHaveLength(3);
    await tocar(lixeiras[2] as HTMLElement);
    expect(tela()).toContain("Excluir esta avaliação? Não dá para desfazer.");
    expect(h.deleteReview).not.toHaveBeenCalled();
    await tocar(botaoPorTexto("Cancelar"));
    expect(tela()).not.toContain("Excluir esta avaliação?");

    await tocar(porRotulo("Excluir avaliação")[2] as HTMLElement);
    await tocar(botaoPorTexto("Excluir"));
    expect(h.deleteReview).toHaveBeenCalledWith("r-3");
  });

  it("sem nenhuma avaliação: 'Sem avaliações ainda'; com filtro ativo: 'Nenhuma avaliação encontrada' e um botão que limpa", async () => {
    h.estado.adminReviews = [];
    await montar();
    expect(tela()).toContain("Sem avaliações ainda");

    armazem.set("admin_reviews_rating_filter", JSON.stringify(3));
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
    expect(tela()).toContain("Nenhuma avaliação encontrada");
    expect(tela()).not.toContain("Sem avaliações ainda");
    await tocar(botaoPorTexto("Limpar busca e filtros"));
    const chamada = h.getAllReviews.mock.calls.at(-1) as unknown[];
    expect((chamada[2] as { rating: unknown }).rating).toBe("all");
  });

  it("erro ao carregar: aviso com 'Tentar de novo', nunca 'Sem avaliações ainda'", async () => {
    h.estado.adminReviews = [];
    h.estado.erro = "Não foi possível carregar as avaliações.";
    await montar();
    const aviso = hospedeiro.querySelector('[role="alert"]');
    expect(norm(aviso?.textContent)).toContain(
      "Não foi possível carregar as avaliações.",
    );
    expect(tela()).not.toContain("Sem avaliações ainda");
    expect(botaoPorTexto("Tentar de novo")).toBeTruthy();
  });

  it("sem internet: um aviso explica e Aprovar, Responder e Excluir ficam apagados", async () => {
    h.estado.offline = true;
    await montar();
    expect(tela()).toContain(
      "Sem conexão. Aprovar, responder e excluir voltam quando a internet voltar.",
    );
    expect(botaoPorTexto("Aprovar").disabled).toBe(true);
    for (const b of [
      ...botoes().filter((x) => norm(x.textContent) === "Responder"),
      ...porRotulo("Excluir avaliação"),
    ]) {
      expect(b.disabled).toBe(true);
    }
  });

  it("nenhuma cor de marca (dourado), degradê, pulso ou fundo decorativo sobra na tela", async () => {
    await montar();
    await tocar(botaoPorTexto("Expandir"));
    const marcacao = hospedeiro.innerHTML;
    expect(marcacao).not.toContain("admin-gold");
    expect(marcacao).not.toContain("bg-gradient");
    expect(marcacao).not.toContain("blur-");
    expect(marcacao).not.toContain("animate-pulse");
  });
});
