// @vitest-environment jsdom
//
// Achado 7 (caça autônoma R4) — a LISTA de perguntas do painel falhava e a
// tela dizia "Fila de perguntas limpa" (os números do topo são outra consulta
// e carregavam bem). Aqui quem é montado é a própria AdminQAView, com o hook
// dublado: o estado `erroDaListagemAdmin` do hook tem prova própria em
// usequestions-admin-lista-que-falha-fica-marcada.test.tsx.
//
// Dois estados que precisam chegar DIFERENTES à tela:
//   1. lista falhou     -> aviso com "Tentar de novo"; JAMAIS "Fila limpa";
//                          o botão pede a lista outra vez
//   2. fila vazia de verdade (controle positivo) -> "Fila de perguntas limpa",
//                          sem aviso
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = { erro: null as string | null };
  const getAllQuestions = vi.fn((..._args: unknown[]) =>
    Promise.resolve({ questions: [], total: 0 }),
  );
  async function getQAStats() {
    return { status: "ok", total: 3, pending: 3, answered: 0, rate: 0 };
  }
  function subscribeToQuestions() {
    return () => {};
  }
  return { estado, getAllQuestions, getQAStats, subscribeToQuestions };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
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

describe("AdminQAView — lista que falha mostra aviso, nunca 'Fila limpa'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.erro = null;
    h.getAllQuestions.mockClear();
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

  async function montar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  it("lista falhou: aviso com 'Tentar de novo' no lugar da fila limpa, e o botão pede a lista de novo", async () => {
    h.estado.erro = "Não foi possível carregar as perguntas.";
    await montar();

    expect(texto()).not.toContain("Fila de perguntas limpa");
    expect(texto()).not.toContain("Nenhuma pergunta ainda");
    expect(texto()).toContain("Não foi possível carregar as perguntas.");

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );
    expect(botao).toBeTruthy();

    const antes = h.getAllQuestions.mock.calls.length;
    await act(async () => {
      botao!.click();
    });
    expect(h.getAllQuestions.mock.calls.length).toBe(antes + 1);
  });

  it("CONTROLE: sem erro, fila vazia de verdade mostra 'Fila de perguntas limpa' e nenhum aviso", async () => {
    await montar();

    expect(texto()).toContain("Fila de perguntas limpa");
    expect(texto()).not.toContain("Não foi possível carregar as perguntas.");
    expect(
      Array.from(hospedeiro.querySelectorAll("button")).some(
        (b) => b.textContent?.trim() === "Tentar de novo",
      ),
    ).toBe(false);
  });
});
