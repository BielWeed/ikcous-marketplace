// @vitest-environment jsdom
//
// Mesmo defeito da vitrine (resposta-da-loja-guarda-as-linhas-na-vitrine
// .test.tsx), na aba Perguntas do perfil público: a resposta da equipe com
// várias linhas aparecia colada numa linha só, porque o <p> não preservava a
// quebra. O teste confere a classe que o CSS precisa (`whitespace-pre-line`);
// jsdom não calcula layout.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
  }),
}));

const RESPOSTA_EM_LINHAS = "Tamanhos disponíveis:\nP - 36\nM - 38";

const perfil = {
  id: "user-alvo",
  full_name: "Cliente Teste",
  avatar_url: null,
  created_at: new Date().toISOString(),
  cover_url: null,
};

const perguntaRpc = {
  id: "pergunta-1",
  product_id: "prod-1",
  question: "Quais tamanhos tem?",
  created_at: new Date().toISOString(),
  produto_nome: "Produto Teste",
  produto_imagem_url: null,
  answers: [
    {
      id: "resp-1",
      answer: RESPOSTA_EM_LINHAS,
      created_at: new Date().toISOString(),
    },
  ],
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: perfil, error: null }),
            }),
          }),
        };
      }
      throw new Error(`from inesperado neste teste: ${tabela}`);
    },
    rpc: (nome: string) => {
      if (nome === "perfil_publico_avaliacoes") {
        return Promise.resolve({ data: [], error: null });
      }
      if (nome === "perfil_publico_perguntas") {
        return Promise.resolve({ data: [perguntaRpc], error: null });
      }
      throw new Error(`rpc inesperado neste teste: ${nome}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileView — resposta da equipe com várias linhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("aba Perguntas: a resposta preserva as quebras de linha", async () => {
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );
    await act(async () => {
      raiz.render(<UserProfileView userId="user-alvo" onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const abaPerguntas = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((b) => b.textContent?.includes("Perguntas"));
    expect(abaPerguntas).toBeTruthy();
    await act(async () => {
      abaPerguntas!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    const paragrafo = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>("p"),
    ).find((p) => p.textContent?.includes("Tamanhos disponíveis:"));
    expect(paragrafo, "parágrafo da resposta").toBeTruthy();
    expect(paragrafo!.textContent).toContain(RESPOSTA_EM_LINHAS);
    expect(paragrafo!.classList.contains("whitespace-pre-line")).toBe(true);
  }, 30000);
});
