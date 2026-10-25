// @vitest-environment jsdom
// Vitrine (25/10): o avatar de quem perguntou saía como <img> SEM atributo alt
// (leitor de tela lê o nome do arquivo). O nome já está escrito ao lado, então
// a foto é decorativa: alt="" (vazio de propósito, não ausente).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Question } from "@/hooks/useQuestions";

const perguntas: Question[] = [
  {
    id: "a",
    userId: "cliente-ficticio",
    productId: "produto-ficticio",
    customerName: "Cliente Teste",
    customerAvatar: "https://exemplo.invalid/avatar.png",
    question: "Pergunta a",
    createdAt: "2026-10-01T09:00:00Z",
    answers: [],
  },
];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: perguntas,
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductQA — avatar decorativo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const ImagemOriginal = window.Image;

  beforeEach(() => {
    // jsdom nunca carrega imagem; o Radix só monta o <img> depois do onload.
    class ImagemQueCarrega extends EventTarget {
      referrerPolicy = "";
      crossOrigin: string | null = null;
      set src(_valor: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    window.Image = ImagemQueCarrega as any;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    window.Image = ImagemOriginal;
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("a foto de quem perguntou tem alt vazio, nunca ausente", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="produto-ficticio" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const img = hospedeiro.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("");
  }, 15000);
});
