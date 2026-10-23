// @vitest-environment jsdom
//
// Redesenho da tela Perguntas do painel (desenho aprovado pelo dono em
// 22/10/2026): barra com o alternador Perguntas|Avaliações e a ajuda, busca,
// filtro Pendentes N / Todas N, resumo numa linha que expande em três
// cartões, cartões neutros (cor só para estado), exclusão pedida por uma
// frase dentro do cartão e a resposta numa folha que sobe de baixo.
//
// Monta a view de verdade (createRoot + act, como os vizinhos) com o hook
// useQuestions dublado. O que se prova aqui é o que a lojista VÊ e TOCA; as
// regras de honestidade dos números (erro não é fila limpa) ficam em
// admin-qa-view-erro-nao-e-fila-limpa.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    stats: {
      status: "ok",
      total: 6,
      pending: 2,
      answered: 4,
      rate: 67,
    } as unknown,
    perguntas: [] as any[],
    offline: false,
  };
  const addAnswer = vi.fn(async (..._args: unknown[]) => true);
  const deleteQuestion = vi.fn(async (..._args: unknown[]) => true);
  const getAllQuestions = vi.fn((..._args: unknown[]) =>
    Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    }),
  );
  async function getQAStats(): Promise<unknown> {
    return estado.stats;
  }
  return { estado, addAnswer, deleteQuestion, getAllQuestions, getQAStats };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: h.addAnswer,
    deleteQuestion: h.deleteQuestion,
    subscribeToQuestions: () => () => {},
    getQAStats: h.getQAStats,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.estado.offline,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

const PENDENTE = {
  id: "q-1",
  userId: "c-1",
  productId: "p-1",
  productName: "caneta 3d",
  customerName: "Isadora Bernardes",
  question: "Eu amei",
  createdAt: "2026-07-07T12:00:00.000Z",
  answers: [],
};
const RESPONDIDA = {
  id: "q-2",
  userId: "c-2",
  productId: "p-2",
  productName: "Bobbie Goods",
  customerName: "Gabriel",
  question: "Este livro de colorir vem com giz de cera?",
  createdAt: "2026-07-07T12:00:00.000Z",
  answers: [
    {
      id: "a-1",
      questionId: "q-2",
      answer: "Olá, Gabriel! Sim, acompanha uma caixinha de giz de cera.",
      createdAt: "2026-07-08T12:00:00.000Z",
    },
  ],
};

describe("AdminQAView — redesenho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.stats = {
      status: "ok",
      total: 6,
      pending: 2,
      answered: 4,
      rate: 67,
    };
    h.estado.perguntas = [PENDENTE, RESPONDIDA];
    h.estado.offline = false;
    h.addAnswer.mockClear();
    h.deleteQuestion.mockClear();
    h.getAllQuestions.mockClear();
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
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  const norm = (t: string | null | undefined) =>
    (t ?? "").replace(/\s+/g, " ").trim();

  function botoes(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll("button"));
  }
  function botaoPorTexto(texto: string): HTMLButtonElement {
    const achado = botoes().find((b) => norm(b.textContent) === texto);
    if (!achado) {
      throw new Error(
        `não achei o botão "${texto}"; há: ${botoes()
          .map((b) => norm(b.textContent) || b.getAttribute("aria-label"))
          .join(" | ")}`,
      );
    }
    return achado;
  }
  async function tocar(el: HTMLElement) {
    await act(async () => {
      el.click();
      await esperar();
    });
  }

  it("o filtro mostra Pendentes 2 e Todas 6, com Pendentes marcado", async () => {
    await montar();
    const grupo = hospedeiro.querySelector('[role="group"][aria-label]');
    expect(grupo?.getAttribute("aria-label")).toBe("Filtrar perguntas");
    const pend = botaoPorTexto("Pendentes 2");
    const todas = botaoPorTexto("Todas 6");
    expect(pend.getAttribute("aria-pressed")).toBe("true");
    expect(todas.getAttribute("aria-pressed")).toBe("false");
  });

  it("tocar em Todas busca todas as perguntas, voltando à primeira página", async () => {
    await montar();
    await tocar(botaoPorTexto("Todas 6"));
    const chamada = h.getAllQuestions.mock.calls.at(-1) as unknown[];
    expect(chamada[0]).toBe(0);
    expect(chamada[2]).toBe("all");
    expect(botaoPorTexto("Todas 6").getAttribute("aria-pressed")).toBe("true");
  });

  it("o resumo cabe numa linha e expande em três cartões", async () => {
    await montar();
    const tela = norm(hospedeiro.textContent);
    expect(tela).toContain("67% respondidas");
    expect(tela).toContain("4 de 6");
    // fechado: os três cartões não estão na tela
    expect(tela).not.toContain("desde o início");

    const expandir = botaoPorTexto("Expandir");
    expect(expandir.getAttribute("aria-expanded")).toBe("false");
    await tocar(expandir);
    const aberto = norm(hospedeiro.textContent);
    expect(aberto).toContain("a responder");
    expect(aberto).toContain("desde o início");
    expect(botaoPorTexto("Recolher").getAttribute("aria-expanded")).toBe(
      "true",
    );
    await tocar(botaoPorTexto("Recolher"));
    expect(norm(hospedeiro.textContent)).not.toContain("desde o início");
  });

  it("o cartão pendente mostra quem, quando, qual produto, o estado e o botão Responder", async () => {
    await montar();
    const tela = norm(hospedeiro.textContent);
    expect(tela).toContain("Isadora Bernardes");
    expect(tela).toContain("07/07/2026");
    expect(tela).toContain("caneta 3d");
    expect(tela).toContain("Eu amei");
    expect(tela).toContain("Pendente");
    expect(botaoPorTexto("Responder")).toBeTruthy();
  });

  it("a pergunta respondida esconde a resposta até tocar na seta e oferece Editar resposta", async () => {
    await montar();
    expect(norm(hospedeiro.textContent)).toContain("Respondida");
    expect(norm(hospedeiro.textContent)).not.toContain("Resposta da loja");

    const setas = botoes().filter(
      (b) => b.getAttribute("aria-label") === "Mostrar detalhes",
    );
    expect(setas).toHaveLength(2);
    expect(setas[1]?.getAttribute("aria-expanded")).toBe("false");
    await tocar(setas[1] as HTMLElement);
    expect(norm(hospedeiro.textContent)).toContain("Resposta da loja");
    expect(norm(hospedeiro.textContent)).toContain("caixinha de giz de cera");
    expect(botaoPorTexto("Editar resposta")).toBeTruthy();
  });

  it("excluir pede confirmação em frase e só apaga ao tocar em Excluir", async () => {
    await montar();
    const lixeiras = botoes().filter(
      (b) => b.getAttribute("aria-label") === "Excluir pergunta",
    );
    expect(lixeiras).toHaveLength(2);
    await tocar(lixeiras[0] as HTMLElement);
    expect(norm(hospedeiro.textContent)).toContain(
      "Excluir esta pergunta? Não dá para desfazer.",
    );
    expect(h.deleteQuestion).not.toHaveBeenCalled();

    // Cancelar volta ao cartão normal sem apagar nada.
    await tocar(botaoPorTexto("Cancelar"));
    expect(norm(hospedeiro.textContent)).not.toContain(
      "Excluir esta pergunta?",
    );
    expect(h.deleteQuestion).not.toHaveBeenCalled();

    await tocar(
      botoes().filter(
        (b) => b.getAttribute("aria-label") === "Excluir pergunta",
      )[0] as HTMLElement,
    );
    await tocar(botaoPorTexto("Excluir"));
    expect(h.deleteQuestion).toHaveBeenCalledWith("q-1", { silent: true });
  });

  it("fila limpa: sem pendentes aparece 'Fila de perguntas limpa'", async () => {
    h.estado.perguntas = [];
    h.estado.stats = {
      status: "ok",
      total: 6,
      pending: 0,
      answered: 6,
      rate: 100,
    };
    await montar();
    expect(norm(hospedeiro.textContent)).toContain("Fila de perguntas limpa");
    expect(botaoPorTexto("Pendentes 0")).toBeTruthy();
  });

  it("busca sem resultado diz o que foi buscado e o botão Limpar busca zera a busca", async () => {
    armazem.set("admin_qa_search_query", JSON.stringify("giz azul"));
    armazem.set("admin_qa_filter", JSON.stringify("all"));
    h.estado.perguntas = [];
    await montar();
    const tela = norm(hospedeiro.textContent);
    expect(tela).toContain("Nenhuma pergunta encontrada");
    expect(tela).toContain("giz azul");
    expect(tela).not.toContain("Fila de perguntas limpa");

    await tocar(botaoPorTexto("Limpar busca"));
    const chamada = h.getAllQuestions.mock.calls.at(-1) as unknown[];
    expect(chamada[3]).toBe("");
  });

  it("sem internet: um aviso explica e Responder e Excluir ficam apagados", async () => {
    h.estado.offline = true;
    await montar();
    expect(norm(hospedeiro.textContent)).toContain(
      "Sem conexão. Responder e excluir voltam quando a internet voltar.",
    );
    expect(botaoPorTexto("Responder").disabled).toBe(true);
    for (const lixeira of botoes().filter(
      (b) => b.getAttribute("aria-label") === "Excluir pergunta",
    )) {
      expect(lixeira.disabled).toBe(true);
    }
  });

  it("Responder abre uma folha nomeada, com a pergunta, o campo e a promessa de avisar a cliente", async () => {
    await montar();
    await tocar(botaoPorTexto("Responder"));

    const folha = document.body.querySelector('[role="dialog"]');
    expect(folha).toBeTruthy();
    const nome =
      folha?.getAttribute("aria-label") ??
      document.getElementById(folha?.getAttribute("aria-labelledby") ?? "")
        ?.textContent;
    expect(nome).toContain("Responder pergunta");
    const texto = norm(folha?.textContent);
    expect(texto).toContain("Isadora Bernardes");
    expect(texto).toContain("caneta 3d");
    expect(texto).toContain("Eu amei");
    expect(texto).toContain("Avisa a cliente no app");
    expect(texto).toContain("0 caracteres");

    const campo = folha?.querySelector<HTMLTextAreaElement>(
      "textarea#merchant-answer",
    );
    expect(campo).toBeTruthy();
    const publicar = Array.from(
      folha?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((b) => norm(b.textContent) === "Publicar resposta");
    expect(publicar?.disabled).toBe(true);

    await act(async () => {
      const setar = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setar?.call(campo, "Oi, Isadora! Que bom que gostou.");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
      await esperar();
    });
    expect(publicar?.disabled).toBe(false);
    await tocar(publicar as HTMLElement);
    expect(h.addAnswer).toHaveBeenCalledWith(
      { questionId: "q-1", answer: "Oi, Isadora! Que bom que gostou." },
      { silent: true },
    );
  });

  it("nenhuma cor de marca (dourado) nem degradê de avatar sobra na tela", async () => {
    await montar();
    await tocar(botaoPorTexto("Expandir"));
    const marcacao = hospedeiro.innerHTML;
    expect(marcacao).not.toContain("admin-gold");
    expect(marcacao).not.toContain("bg-gradient");
    expect(marcacao).not.toContain("animate-pulse");
  });
});
