// @vitest-environment jsdom
//
// O SAFARI DO IPHONE AMPLIA A TELA QUANDO UM CAMPO COM FONTE MENOR QUE 16 px
// GANHA FOCO. O campo de comentário da avaliação (`text-xs`) e o da pergunta
// ao vendedor (`text-sm`) ficavam abaixo disso: ao tocar neles a tela dava
// zoom. A convenção do repositório (veja o formulário de endereço) é
// `text-base` no celular e o tamanho pequeno só de `md:` para cima.
//
// O CSS do Tailwind não existe no jsdom: o que se prova é a classe no
// elemento renderizado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-1", email: "cliente@ikcous.com" },
    profile: { full_name: "Cliente", avatar_url: null },
    isAdmin: false,
  }),
}));
// Sem vi.importActual: o módulo real cria um client Supabase só de ser
// importado (mesmo comentário de product-qa-edit-prefill.test.tsx).
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function classesDe(el: Element | null): string[] {
  expect(el).not.toBeNull();
  return (el as Element).className.split(/\s+/);
}

describe("campos de texto sem zoom no iPhone", () => {
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
  });

  it("comentário da avaliação: 16 px no celular (text-base), pequeno só de md para cima", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" />);
    });
    const classes = classesDe(hospedeiro.querySelector("textarea"));
    expect(classes).toContain("text-base");
    expect(classes).toContain("md:text-sm");
    expect(classes).not.toContain("text-xs");
    expect(classes).not.toContain("text-sm");
  });

  it("pergunta ao vendedor: 16 px no celular (text-base), pequeno só de md para cima", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="p-1" />);
    });
    const classes = classesDe(document.getElementById("qa-new-question"));
    expect(classes).toContain("text-base");
    expect(classes).toContain("md:text-sm");
    expect(classes).not.toContain("text-xs");
    expect(classes).not.toContain("text-sm");
  });
});
