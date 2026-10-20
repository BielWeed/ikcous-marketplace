// @vitest-environment jsdom
// Regressão: recarregar após responder/excluir precisa atualizar total e página.
import type { Question } from "@/hooks/useQuestions";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  perguntas: [] as Question[],
  recargaFalhou: false,
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
    h.perguntas = h.perguntas.filter((q) => q.id !== id);
    return true;
  }

  async function getQAStats() {
    return { status: "ok", total: 0, pending: 0, answered: 0, rate: 0 };
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
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
        'button[title="Excluir Pergunta"]',
      );
      expect(excluir).not.toBeNull();
      await act(async () => excluir!.click());
      await clicar("Sim");
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
      await clicar("Publicar Resposta");
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
      expect(hospedeiro.textContent).toContain("Fila de Perguntas Limpa");
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
    await clicar("Todas");
    expect(armazem.get("admin_qa_page")).toBe("0");
    expect(hospedeiro.textContent).toContain("Dúvida número 1?");
  });

  it("trocar a busca volta à primeira página", async () => {
    await montar();
    const campo = hospedeiro.querySelector("#qa-search");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(campo, "número 1?");
      campo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(armazem.get("admin_qa_page")).toBe("0");
    expect(hospedeiro.textContent).toContain("Dúvida número 1?");
    expect(hospedeiro.textContent).not.toContain("Dúvida número 21?");
  });
});
