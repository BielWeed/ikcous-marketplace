// @vitest-environment jsdom
//
// Auditoria de acessibilidade (06/11/2026): na página do produto os títulos
// iam de h1 (nome) direto para h3, sem nenhum h2, e o checkout não tinha h1
// (quem usa leitor de tela e pede "próximo título nível 1" não achava nada).
// Só marcação: o visual não muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FONTES = import.meta.glob<string>(
  [
    "/src/views/customer/ProductView.tsx",
    "/src/views/customer/CheckoutView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);
const fonte = (caminho: string) =>
  (Object.entries(FONTES).find(([k]) => k === caminho)?.[1] as string).replace(
    /\r\n/g,
    "\n",
  );

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

describe("títulos sem salto de nível", () => {
  it("ProductQA: 'Perguntas ao vendedor' é h2 (a seção fica logo abaixo do h1 do produto)", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const titulo = [...hospedeiro.querySelectorAll("h1,h2,h3")].find(
      (h) => h.textContent === "Perguntas ao vendedor",
    );
    expect(titulo?.tagName).toBe("H2");
    expect(hospedeiro.querySelector("h3")).toBeNull();
  });

  it("ProductView: 'Avaliações' e 'Você também pode gostar' são h2", () => {
    const src = fonte("/src/views/customer/ProductView.tsx");
    expect(src).not.toMatch(/<h3[\s>]/);
    expect(src).toMatch(
      /<h2\s+className=\{cn\(\s*"text-lg font-extrabold[\s\S]*?Avaliações\s*<\/h2>/,
    );
    expect(src).toMatch(
      /<h2 className="[^"]*">\s*Você também pode gostar\s*<\/h2>/,
    );
  });

  it("CheckoutView: a tela principal tem um h1 'Finalizar compra' só para leitor de tela", () => {
    const src = fonte("/src/views/customer/CheckoutView.tsx");
    expect(src).toContain('<h1 className="sr-only">Finalizar compra</h1>');
  });
});
