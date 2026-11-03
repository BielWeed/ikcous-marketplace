// @vitest-environment jsdom
// Regressão: pergunta nova avisada em tempo real recarrega a lista E os
// contadores do topo (Pendentes, Todas, % respondidas), não só a lista.
import type { Question } from "@/hooks/useQuestions";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  perguntas: [] as Question[],
  aoEvento: null as (() => void) | null,
  getQAStats: vi.fn(),
}));

vi.mock("@/hooks/useQuestions", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useQuestions: () => {
      const [questions, setQuestions] = useState<Question[]>([]);
      const getAllQuestions = useCallback(async () => {
        setQuestions(h.perguntas);
        return { questions: h.perguntas, total: h.perguntas.length };
      }, []);
      return {
        questions,
        loading: false,
        getAllQuestions,
        addAnswer: async () => true,
        deleteQuestion: async () => true,
        getQAStats: h.getQAStats,
        subscribeToQuestions: (callback: () => void) => {
          h.aoEvento = callback;
          return () => {
            h.aoEvento = null;
          };
        },
      };
    },
  };
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

describe("AdminQAView — pergunta nova em tempo real atualiza os contadores", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.aoEvento = null;
    h.perguntas = [];
    h.getQAStats.mockReset();
    h.getQAStats
      .mockResolvedValueOnce({
        status: "ok",
        total: 0,
        pending: 0,
        answered: 0,
        rate: 0,
      })
      .mockResolvedValue({
        status: "ok",
        total: 1,
        pending: 1,
        answered: 0,
        rate: 0,
      });
    const armazem = new Map<string, string>();
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

  it("o aviso de pergunta nova refaz a contagem e o chip Pendentes sobe", async () => {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} />);
    });
    expect(h.getQAStats).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Pendentes 0");

    h.perguntas = [
      {
        id: "q-1",
        userId: "cliente-teste",
        productId: "produto-teste",
        productName: "Produto de teste",
        customerName: "Cliente de teste",
        question: "Tem em outra cor?",
        createdAt: "2026-10-20T10:00:00Z",
        answers: [],
      },
    ];
    expect(h.aoEvento).not.toBeNull();
    await act(async () => h.aoEvento!());

    expect(h.getQAStats).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("Tem em outra cor?");
    expect(hospedeiro.textContent).toContain("Pendentes 1");
  });
});
