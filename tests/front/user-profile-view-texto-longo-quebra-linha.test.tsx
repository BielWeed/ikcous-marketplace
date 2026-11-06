// @vitest-environment jsdom
//
// Perfil de OUTRA pessoa: um comentário, uma resposta da loja, uma pergunta ou
// uma resposta da equipe com texto longo SEM espaços (um link, por exemplo)
// estourava o cartão para a direita — o ReviewCard da página do produto já
// quebrava essa linha com `break-words`, os parágrafos do perfil não.
//
// jsdom não calcula layout, então o teste confere o que o CSS precisa: a
// classe `break-words` (overflow-wrap: break-word) em cada um dos quatro
// parágrafos de texto livre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
  }),
}));

const LINK_LONGO = `https://exemplo.com.br/${"a".repeat(120)}`;

const perfil = {
  id: "user-alvo",
  full_name: "Cliente Teste",
  avatar_url: null,
  created_at: new Date().toISOString(),
  cover_url: null,
};

const reviewRpc = {
  id: "review-1",
  product_id: "prod-1",
  rating: 5,
  comment: `Comentário ${LINK_LONGO}`,
  created_at: new Date().toISOString(),
  helpful: 0,
  verified: false,
  merchant_reply: `Resposta da loja ${LINK_LONGO}`,
  merchant_reply_at: new Date().toISOString(),
  produto_nome: "Produto Teste",
  produto_imagem_url: null,
};

const perguntaRpc = {
  id: "pergunta-1",
  product_id: "prod-1",
  question: `Pergunta ${LINK_LONGO}`,
  created_at: new Date().toISOString(),
  produto_nome: "Produto Teste",
  produto_imagem_url: null,
  answers: [
    {
      id: "resp-1",
      answer: `Resposta da equipe ${LINK_LONGO}`,
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
        return Promise.resolve({ data: [reviewRpc], error: null });
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

describe("UserProfileView — texto longo sem espaço quebra linha em vez de estourar o cartão", () => {
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

  async function montar() {
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
  }

  /** O parágrafo mais interno cujo texto contém `trecho`. */
  function paragrafo(trecho: string): HTMLElement {
    const achado = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>("p"),
    ).find((p) => p.textContent?.includes(trecho));
    expect(achado, `parágrafo com "${trecho}"`).toBeTruthy();
    return achado as HTMLElement;
  }

  it("aba Avaliações: comentário e resposta da loja têm break-words", async () => {
    await montar();

    expect(
      paragrafo("Comentário https://").classList.contains("break-words"),
    ).toBe(true);
    expect(
      paragrafo("Resposta da loja https://").classList.contains("break-words"),
    ).toBe(true);
  }, 30000);

  it("aba Perguntas: pergunta e resposta da equipe têm break-words", async () => {
    await montar();

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

    expect(
      paragrafo("Pergunta https://").classList.contains("break-words"),
    ).toBe(true);
    expect(
      paragrafo("Resposta da equipe https://").classList.contains(
        "break-words",
      ),
    ).toBe(true);
  }, 30000);
});
