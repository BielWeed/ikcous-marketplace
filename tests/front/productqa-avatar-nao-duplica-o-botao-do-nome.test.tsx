// @vitest-environment jsdom
// Acessibilidade (24/11): em cada pergunta, o avatar era um `div role="button"
// tabIndex=0` SEM nome e o nome de quem perguntou era OUTRO botão para o mesmo
// destino — o leitor de tela anunciava "botão" mudo e o Tab parava duas vezes
// no mesmo lugar. Agora o avatar é decorativo (aria-hidden, fora do Tab, o
// clique do mouse continua levando ao perfil) e o botão do nome é o único, com
// alvo de 44 px de altura.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Question } from "@/hooks/useQuestions";

const perguntas: Question[] = [
  {
    id: "a",
    userId: "cliente-ficticio",
    productId: "produto-ficticio",
    customerName: "Maria",
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

describe("ProductQA — avatar decorativo e botão do nome com 44 px", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(comNavegacao: boolean) {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(
        <ProductQA
          productId="produto-ficticio"
          onNavigate={comNavegacao ? onNavigate : undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const avatarDoCartao = () =>
    hospedeiro.querySelector('[data-slot="avatar"]')
      ?.parentElement as HTMLElement;

  it("com perfil clicável: só o nome é botão; o avatar é aria-hidden, sem role nem Tab", async () => {
    await montar(true);
    const botoes = [...hospedeiro.querySelectorAll('[role="button"]')];
    const doNome = botoes.filter((b) => b.textContent?.includes("Maria"));
    expect(doNome).toHaveLength(1);
    expect(doNome[0]?.getAttribute("tabindex")).toBe("0");

    const avatar = avatarDoCartao();
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.getAttribute("role")).toBeNull();
    expect(avatar.getAttribute("tabindex")).toBeNull();
    // Nenhum outro botão sem nome sobrou na pergunta.
    expect(botoes.filter((b) => !b.textContent?.trim())).toHaveLength(0);
  });

  it("o botão do nome tem alvo de 44 px (min-h-11) e continua abrindo o perfil", async () => {
    await montar(true);
    const nome = [...hospedeiro.querySelectorAll('[role="button"]')].find((b) =>
      b.textContent?.includes("Maria"),
    ) as HTMLElement;
    expect(nome.className).toContain("min-h-11");
    act(() => nome.click());
    expect(onNavigate).toHaveBeenCalledWith("user-profile", "cliente-ficticio");
  });

  it("o clique do mouse no avatar continua levando ao perfil", async () => {
    await montar(true);
    act(() => avatarDoCartao().click());
    expect(onNavigate).toHaveBeenCalledWith("user-profile", "cliente-ficticio");
  });

  it("sem navegação (visitante sem perfil): nada vira botão e o nome não ganha altura de alvo", async () => {
    await montar(false);
    expect(hospedeiro.querySelectorAll('[role="button"]')).toHaveLength(0);
    const nome = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Maria",
    ) as HTMLElement;
    expect(nome.className).not.toContain("min-h-11");
  });
});
