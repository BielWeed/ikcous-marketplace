// @vitest-environment jsdom
// Regressão: recarregar após responder/excluir precisa atualizar total e página.
import type { Question } from "@/hooks/useQuestions";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  perguntas: [] as Question[],
  recargaFalhou: false,
  leituras: vi.fn(),
  aguardarLista: null as Promise<void> | null,
  aguardarExclusao: null as Promise<boolean | null> | null,
  aoEvento: null as (() => void) | null,
}));

vi.mock("@/hooks/useQuestions", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useQuestions: () => {
      const [questions, setQuestions] = useState<Question[]>([]);
      const getAllQuestions = useCallback(
        async (
          page: number,
          pageSize: number,
          filter: string,
          search: string,
        ) => {
          h.leituras(page, pageSize, filter, search);
          await h.aguardarLista;
          if (h.recargaFalhou) {
            return { questions: [], total: 0, falhou: true };
          }
          const filtradas = h.perguntas.filter(
            (q) =>
              (filter === "all" || q.answers.length === 0) &&
              q.question.includes(search),
          );
          const pagina = filtradas.slice(
            page * pageSize,
            (page + 1) * pageSize,
          );
          setQuestions(pagina);
          return { questions: pagina, total: filtradas.length };
        },
        [],
      );
      return {
        questions,
        loading: false,
        getAllQuestions,
        addAnswer,
        deleteQuestion,
        getQAStats,
        subscribeToQuestions,
      };
    },
  };

  async function addAnswer({ questionId }: { questionId: string }) {
    h.perguntas = h.perguntas.map((q) =>
      q.id === questionId
        ? {
            ...q,
            answers: [
              {
                id: "resposta",
                questionId,
                answer: "Sim.",
                createdAt: "2026-10-20T12:00:00Z",
              },
            ],
          }
        : q,
    );
    return true;
  }

  async function deleteQuestion(id: string) {
    const resultado = h.aguardarExclusao ? await h.aguardarExclusao : true;
    h.perguntas = h.perguntas.filter((q) => q.id !== id);
    return resultado;
  }

  async function getQAStats() {
    const total = h.perguntas.length;
    const pending = h.perguntas.filter((q) => q.answers.length === 0).length;
    return {
      status: "ok",
      total,
      pending,
      answered: total - pending,
      rate: total > 0 ? Math.round(((total - pending) / total) * 100) : 0,
    };
  }

  // As ações não dependem de realtime; um teste dispara a recarga cancelada.
  function subscribeToQuestions(callback: () => void) {
    h.aoEvento = callback;
    return () => {
      h.aoEvento = null;
    };
  }
});

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminQAView — página acompanha a lista após uma ação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    h.recargaFalhou = false;
    h.aguardarLista = null;
    h.aguardarExclusao = null;
    h.leituras.mockClear();
    h.aoEvento = null;
    h.perguntas = Array.from({ length: 21 }, (_, i) => ({
      id: `q-${i + 1}`,
      userId: "cliente-teste",
      productId: "produto-teste",
      productName: "Produto de teste",
      customerName: "Cliente de teste",
      question: `Dúvida número ${i + 1}?`,
      createdAt: "2026-10-20T10:00:00Z",
      answers: [],
    }));
    armazem = new Map([["admin_qa_page", "2"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => armazem.get(key) ?? null,
      setItem: (key: string, value: string) => armazem.set(key, value),
      removeItem: (key: string) => armazem.delete(key),
    });
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} />);
    });
  }

  async function clicar(texto: string) {
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao, texto).toBeTruthy();
    await act(async () => botao!.click());
  }

  async function agir(acao: string) {
    if (acao === "excluir") {
      const excluir = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Excluir pergunta"]',
      );
      expect(excluir).not.toBeNull();
      await act(async () => excluir!.click());
      await clicar("Excluir");
    } else {
      await clicar("Responder");
      const campo = document.body.querySelector("#merchant-answer");
      expect(campo).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      await act(async () => {
        setter.call(campo, "Sim.");
        campo!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await clicar("Publicar resposta");
    }
  }

  it.each(["excluir", "responder"])(
    "%s a última pergunta da página 3 volta à página 2, não à primeira",
    async (acao) => {
      await montar();
      expect(hospedeiro.textContent).toContain("Dúvida número 21?");
      await agir(acao);

      expect(armazem.get("admin_qa_page")).toBe("1");
      expect(hospedeiro.textContent).toContain("Dúvida número 11?");
      expect(hospedeiro.textContent).not.toContain("Dúvida número 21?");
      expect(hospedeiro.textContent?.replace(/\s+/g, " ")).toMatch(
        /Página\s*2\s*de\s*2/,
      );
    },
  );

  it.each(["excluir", "responder"])(
    "%s uma pergunta mantém a página quando ainda existem perguntas nela",
    async (acao) => {
      h.perguntas = h.perguntas.slice(0, 12);
      armazem.set("admin_qa_page", "1");
      await montar();
      await agir(acao);

      expect(armazem.get("admin_qa_page")).toBe("1");
      expect(hospedeiro.textContent).toContain("Dúvida número 12?");
      expect(hospedeiro.textContent).not.toContain("Dúvida número 11?");
    },
  );

  it.each(["excluir", "responder"])(
    "%s a única pergunta deixa a lista vazia na primeira página",
    async (acao) => {
      h.perguntas = h.perguntas.slice(0, 1);
      armazem.set("admin_qa_page", "0");
      await montar();
      await agir(acao);

      expect(armazem.get("admin_qa_page")).toBe("0");
      expect(hospedeiro.textContent).not.toContain("Dúvida número 1?");
      expect(hospedeiro.textContent).toContain(
        acao === "excluir"
          ? "Nenhuma pergunta ainda"
          : "Fila de perguntas limpa",
      );
    },
  );

  it.each(["excluir", "responder"])(
    "%s com erro na recarga preserva a página 3 e o total anterior",
    async (acao) => {
      await montar();
      expect(hospedeiro.textContent?.replace(/\s+/g, " ")).toMatch(
        /Página\s*3\s*de\s*3/,
      );
      h.recargaFalhou = true;
      await agir(acao);

      expect(armazem.get("admin_qa_page")).toBe("2");
      expect(hospedeiro.textContent?.replace(/\s+/g, " ")).toMatch(
        /Página\s*3\s*de\s*3/,
      );
    },
  );

  it("recarga cancelada em evento realtime preserva a página e o total", async () => {
    await montar();
    h.recargaFalhou = true;
    expect(h.aoEvento).not.toBeNull();
    await act(async () => h.aoEvento!());

    expect(armazem.get("admin_qa_page")).toBe("2");
    expect(hospedeiro.textContent?.replace(/\s+/g, " ")).toMatch(
      /Página\s*3\s*de\s*3/,
    );
    expect(hospedeiro.textContent).toContain("Dúvida número 21?");
  });

  it("corrige uma página salva que já não existe ao abrir a tela", async () => {
    armazem.set("admin_qa_page", "5");
    await montar();
    expect(armazem.get("admin_qa_page")).toBe("2");
    expect(hospedeiro.textContent).toContain("Dúvida número 21?");
  });

  it("trocar o filtro volta à primeira página", async () => {
    await montar();
    await clicar("Todas 21"); // a contagem acompanha as perguntas do cenário
    expect(armazem.get("admin_qa_page")).toBe("0");
    expect(hospedeiro.textContent).toContain("Dúvida número 1?");
  });

  async function digitarBusca(texto: string) {
    const campo = hospedeiro.querySelector("#qa-search");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(campo, texto);
      campo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function buscar(texto: string) {
    await digitarBusca(texto);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
  }

  it.each([true, null])(
    "exclusão com retorno %s recarrega a busca atual",
    async (resultado) => {
      armazem.set("admin_qa_page", "0");
      h.perguntas = h.perguntas.slice(0, 3).map((q, i) => ({
        ...q,
        question: ["vestido azul", "vestido verde", "saia preta"][i],
      }));
      armazem.set("admin_qa_search_query", JSON.stringify("vestido"));
      let liberar!: (valor: boolean | null) => void;
      h.aguardarExclusao = new Promise((resolve) => {
        liberar = resolve;
      });
      await montar();
      expect(hospedeiro.textContent).toContain("vestido azul");
      await agir("excluir");
      await buscar("saia");
      expect(hospedeiro.textContent).toContain("saia preta");

      const antes = h.leituras.mock.calls.length;
      await act(async () => liberar(resultado));
      expect(h.leituras.mock.calls.length).toBeGreaterThan(antes);
      expect(h.leituras).toHaveBeenLastCalledWith(0, 10, "pending", "saia");
      expect(hospedeiro.textContent).toContain("saia preta");
      expect(hospedeiro.textContent).not.toContain("vestido verde");
    },
  );

  it("bloqueia as ações assim que a busca é digitada e libera ao voltar ao texto aplicado", async () => {
    armazem.set("admin_qa_page", "0");
    armazem.set("admin_qa_search_query", JSON.stringify("Dúvida"));
    await montar();
    vi.useFakeTimers();
    try {
      const linha = hospedeiro.querySelector("li")!;
      const botoes = Array.from(
        linha.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Responder"], button[title="Excluir pergunta"]',
        ),
      );
      expect(botoes).toHaveLength(2);
      expect(botoes.every((botao) => !botao.disabled)).toBe(true);
      const antes = h.leituras.mock.calls.length;
      await digitarBusca("saia");
      expect(
        hospedeiro.querySelector<HTMLInputElement>("#qa-search")?.value,
      ).toBe("saia");
      expect(h.leituras.mock.calls.length).toBe(antes);
      for (const botao of botoes) {
        botao.focus();
        expect(document.activeElement).not.toBe(botao);
        expect(botao.disabled).toBe(true);
        await act(async () => botao.click());
      }
      expect(document.querySelector("#merchant-answer")).toBeNull();
      expect(linha.textContent).not.toContain("Não dá para desfazer");

      await digitarBusca("Dúvida");
      expect(h.leituras.mock.calls.length).toBe(antes);
      expect(botoes.every((botao) => !botao.disabled)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bloqueia a confirmação de exclusão aberta antes de digitar a nova busca", async () => {
    armazem.set("admin_qa_page", "0");
    await montar();
    vi.useFakeTimers();
    try {
      const linha = hospedeiro.querySelector("li")!;
      await act(async () =>
        linha
          .querySelector<HTMLButtonElement>('button[title="Excluir pergunta"]')!
          .click(),
      );
      const confirmar = Array.from(linha.querySelectorAll("button")).find(
        (botao) => botao.textContent?.trim() === "Excluir",
      )!;
      expect(confirmar.disabled).toBe(false);
      await digitarBusca("número 2?");
      expect(confirmar.disabled).toBe(true);
      await act(async () => confirmar.click());
      await clicar("Cancelar");
      expect(h.perguntas).toHaveLength(21);
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(h.leituras).toHaveBeenLastCalledWith(
        0,
        10,
        "pending",
        "número 2?",
      );
      expect(
        hospedeiro.querySelector<HTMLButtonElement>(
          'button[title="Excluir pergunta"]',
        )?.disabled,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    "exclusão resolve durante o debounce (aplica nova busca: %s)",
    async (aplicaNova) => {
      armazem.set("admin_qa_page", "0");
      armazem.set("admin_qa_search_query", JSON.stringify("vestido"));
      h.perguntas = h.perguntas.slice(0, 3).map((q, i) => ({
        ...q,
        question: ["vestido azul", "vestido verde", "saia preta"][i],
      }));
      let liberar!: (valor: boolean) => void;
      h.aguardarExclusao = new Promise((resolve) => {
        liberar = resolve;
      });
      await montar();
      vi.useFakeTimers();
      try {
        await agir("excluir");
        await digitarBusca("saia");
        const antes = h.leituras.mock.calls.length;
        await act(async () => liberar(true));
        expect(h.leituras.mock.calls.length).toBe(antes);
        if (aplicaNova) {
          await act(async () => vi.advanceTimersByTimeAsync(300));
        } else {
          await digitarBusca("vestido");
        }
        expect(h.leituras.mock.calls.length).toBe(antes + 1);
        expect(h.leituras).toHaveBeenLastCalledWith(
          0,
          10,
          "pending",
          aplicaNova ? "saia" : "vestido",
        );
        expect(hospedeiro.textContent).toContain(
          aplicaNova ? "saia preta" : "vestido verde",
        );
        expect(hospedeiro.textContent).not.toContain("vestido azul");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["responder", "excluir", "confirmar"])(
    "não deixa %s pela lista antiga durante a troca de filtro",
    async (acao) => {
      armazem.set("admin_qa_page", "0");
      armazem.set("admin_qa_filter", JSON.stringify("all"));
      h.perguntas = h.perguntas.slice(0, 2);
      const respondida = h.perguntas[0];
      respondida.answers = [
        {
          id: "resposta-antiga",
          questionId: respondida.id,
          answer: "Já respondida.",
          createdAt: respondida.createdAt,
        },
      ];
      await montar();
      const antigo = hospedeiro.querySelector("li")!;
      const excluir = antigo.querySelector<HTMLButtonElement>(
        'button[title="Excluir pergunta"]',
      )!;
      if (acao === "confirmar") await act(async () => excluir.click());
      const botao =
        acao === "excluir"
          ? excluir
          : Array.from(antigo.querySelectorAll("button")).find(
              (b) =>
                b.textContent?.trim() ===
                (acao === "confirmar" ? "Excluir" : "Editar resposta"),
            )!;
      let liberar!: () => void;
      h.aguardarLista = new Promise((resolve) => {
        liberar = resolve;
      });
      await clicar("Pendentes 1");

      // O dublê está com loading=false: só a identidade da consulta protege aqui.
      botao.focus();
      expect(document.activeElement).not.toBe(botao);
      expect(botao.disabled).toBe(true);
      await act(async () => botao.click());
      if (acao === "confirmar") {
        await clicar("Cancelar");
        expect(h.perguntas).toHaveLength(2);
      } else {
        expect(document.querySelector("#merchant-answer")).toBeNull();
        expect(antigo.textContent).not.toContain("Não dá para desfazer");
      }
      await act(async () => liberar());
      expect(hospedeiro.contains(antigo)).toBe(false);
      const responder = hospedeiro.querySelector<HTMLButtonElement>(
        'button[aria-label^="Responder"]',
      )!;
      expect(responder.disabled).toBe(false);
      responder.focus();
      expect(document.activeElement).toBe(responder);
      await act(async () => responder.click());
      expect(document.querySelector("#merchant-answer")).not.toBeNull();
    },
  );

  it.each([
    [499, 500, "Quase 100%", "99%"],
    [500, 500, "100%", "100%"],
    [0, 500, "0%", "0%"],
    [0, 0, "—", undefined],
  ])(
    "%i de %i respostas: resumo mostra %s",
    async (respondidas, total, rotulo, largura) => {
      const base = h.perguntas[0];
      h.perguntas = Array.from({ length: total }, (_, i) => ({
        ...base,
        id: String(i),
        answers:
          i < respondidas
            ? [
                {
                  id: String(i),
                  questionId: String(i),
                  answer: "Sim.",
                  createdAt: base.createdAt,
                },
              ]
            : [],
      }));
      armazem.set("admin_qa_page", "0");
      await montar();
      expect(hospedeiro.textContent).toContain(
        total === 0 ? "Nenhuma pergunta ainda" : `${rotulo} respondidas`,
      );
      await clicar("Expandir");
      const cartao = Array.from(hospedeiro.querySelectorAll("span")).find(
        (el) => el.textContent === "Respondidas",
      )?.parentElement;
      expect(cartao?.textContent).toContain(rotulo);
      expect(
        cartao?.querySelector<HTMLElement>("span[style]")?.style.width,
      ).toBe(largura);
    },
  );

  it("trocar a busca volta à primeira página", async () => {
    await montar();
    await buscar("número 1?");
    expect(armazem.get("admin_qa_page")).toBe("0");
    expect(hospedeiro.textContent).toContain("Dúvida número 1?");
    expect(hospedeiro.textContent).not.toContain("Dúvida número 21?");
  });
});
