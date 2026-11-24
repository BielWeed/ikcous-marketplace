// @vitest-environment jsdom
import type { QAStatsResult, Question } from "@/hooks/useQuestions";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    servidorDisponivel: false,
    erro: null as string | null,
    perguntas: [] as Question[],
  };

  async function getAllQuestions() {
    if (!estado.servidorDisponivel) {
      estado.erro = "Não foi possível carregar as perguntas.";
      return { questions: [], total: 0, falhou: true };
    }

    estado.erro = null;
    estado.perguntas = [
      "Tem em azul?",
      "Vocês enviam para o interior?",
      "Qual é o tamanho?",
    ].map((question, indice) => ({
      id: `q-${indice}`,
      productId: "produto-teste",
      productName: "Produto de teste",
      customerName: "Cliente de teste",
      question,
      createdAt: "2026-08-20T10:00:00Z",
      answers: [],
    }));
    return { questions: estado.perguntas, total: 3 };
  }

  async function getQAStats(): Promise<QAStatsResult> {
    return estado.servidorDisponivel
      ? { status: "ok", total: 3, pending: 3, answered: 0, rate: 0 }
      : { status: "error", error: { message: "HTTP 500" } };
  }

  function subscribeToQuestions() {
    return () => {};
  }

  return { estado, getAllQuestions, getQAStats, subscribeToQuestions };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    erroDaListagemAdmin: h.estado.erro,
    getAllQuestions: h.getAllQuestions,
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: h.subscribeToQuestions,
    getQAStats: h.getQAStats,
  }),
}));
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

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  h.estado.servidorDisponivel = false;
  h.estado.erro = null;
  h.estado.perguntas = [];
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
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

it("recupera a lista e os números das perguntas com um toque em Tentar de novo", async () => {
  const { AdminQAView } = await import("@/views/admin/AdminQAView");
  await act(async () => {
    raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(texto()).toContain("Não foi possível carregar as perguntas.");
  expect(texto()).toContain("Pendentes —");
  expect(texto()).toContain("Erro ao atualizar");

  const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Tentar de novo",
  );
  expect(botao).toBeTruthy();

  h.estado.servidorDisponivel = true;
  await act(async () => {
    botao!.click();
  });

  const tela = texto();
  expect(tela).toContain("Tem em azul?");
  expect(tela).toContain("Vocês enviam para o interior?");
  expect(tela).toContain("Qual é o tamanho?");
  expect.soft(tela).toContain("Pendentes 3");
  expect.soft(tela).not.toContain("Erro ao atualizar");
});
