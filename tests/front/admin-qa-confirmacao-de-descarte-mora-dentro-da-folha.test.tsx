// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const perguntas = [
    {
      id: "q-1",
      userId: "cliente-1",
      productId: "prod-1",
      productName: "Produto de Teste",
      customerName: "Cliente Teste",
      question: "Tem em estoque?",
      createdAt: "2026-08-20T10:00:00Z",
      answers: [],
    },
  ];
  return {
    perguntas,
    getAllQuestions: async () => ({ questions: perguntas, total: 1 }),
    getQAStats: async () => ({
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    }),
  };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.perguntas,
    loading: false,
    getAllQuestions: h.getAllQuestions,
    getQAStats: h.getQAStats,
    subscribeToQuestions: () => () => {},
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Atendimento — confirmação dentro da folha de resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
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

  function botao(texto: string, dentro: ParentNode = document.body) {
    const encontrado = [...dentro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(encontrado).toBeTruthy();
    return encontrado!;
  }

  async function clicar(alvo: HTMLElement) {
    await act(async () => alvo.click());
  }

  async function esc(alvo: HTMLElement) {
    await act(async () => {
      alvo.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  async function abrir(texto = "") {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active />);
    });
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
    await clicar(botao("Responder"));
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement;
    expect(campo).not.toBeNull();
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const folha = campo.closest('[data-slot="sheet-content"]') as HTMLElement;
    expect(folha).not.toBeNull();
    return { campo, folha };
  }

  function perguntaNaFolha(folha: HTMLElement) {
    const pergunta = document.body.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(pergunta).not.toBeNull();
    expect(folha.contains(pergunta)).toBe(true);
    return pergunta;
  }

  for (const gesto of ["X", "Esc"] as const) {
    it(`${gesto}: pergunta dentro da folha, continuar preserva e descartar fecha`, async () => {
      const { campo, folha } = await abrir("Resposta preservada");
      const fechar = folha.querySelector(
        'button[aria-label="Fechar"]',
      ) as HTMLElement;
      const tentarFechar = () => (gesto === "X" ? clicar(fechar) : esc(campo));
      await tentarFechar();
      const pergunta = perguntaNaFolha(folha);
      const continuar = botao("Continuar editando", pergunta);
      expect(document.activeElement).toBe(continuar);
      await clicar(continuar);
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(campo.isConnected).toBe(true);
      expect(campo.value).toBe("Resposta preservada");
      expect(folha.contains(document.activeElement)).toBe(true);

      await tentarFechar();
      await esc(perguntaNaFolha(folha));
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(campo.isConnected).toBe(true);
      expect(campo.value).toBe("Resposta preservada");

      await tentarFechar();
      await clicar(botao("Descartar", perguntaNaFolha(folha)));
      expect(document.getElementById("merchant-answer")).toBeNull();
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it(`${gesto}: sem texto fecha sem perguntar`, async () => {
      const { campo, folha } = await abrir();
      if (gesto === "X") {
        await clicar(
          folha.querySelector('button[aria-label="Fechar"]') as HTMLElement,
        );
      } else {
        await esc(campo);
      }
      expect(document.getElementById("merchant-answer")).toBeNull();
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });
  }
});
