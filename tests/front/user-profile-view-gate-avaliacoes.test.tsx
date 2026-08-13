// @vitest-environment jsdom
//
// Issue #202 (ADMIN-091): o perfil público de outro cliente continuava
// mostrando a estrela da avaliação de cada review na aba "Avaliações" mesmo
// com `store_config.enable_reviews = false`. O texto/comentário da review
// continua (não é dado de "nota"), só a nota em si some.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de order-details-gate-avaliacoes.test.tsx, que também
// mocka `@/lib/supabase` direto pela mesma razão (client de verdade usa Web
// Worker, indisponível no jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews },
  }),
}));

const perfil = {
  id: "user-alvo",
  full_name: "Cliente Teste",
  avatar_url: null,
  created_at: new Date().toISOString(),
  cover_url: null,
};

const review = {
  id: "review-1",
  product_id: "prod-1",
  rating: 5,
  comment: "Produto ótimo, chegou rápido.",
  created_at: new Date().toISOString(),
  verified: true,
  helpful: 2,
  merchant_reply: null,
  product: { id: "prod-1", nome: "Produto Teste", imagem_url: [] },
};

// UserProfileView chama `supabase.from(tabela).select().eq()...` três vezes
// em sequência (perfil, reviews, questions) -- ver comentário de
// order-details-gate-avaliacoes.test.tsx sobre por que mockar o client
// direto em vez de `vi.importActual`.
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
      if (tabela === "reviews") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [review], error: null }),
            }),
          }),
        };
      }
      // questions
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileView — gate do interruptor de Avaliações (ADMIN-091, #202)", () => {
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
    enableReviews = true;
  });

  it("com o flag DESLIGADO, a estrela da review some mas o comentário continua", async () => {
    // Timeout maior que o padrão (5000ms): o primeiro import dinâmico deste
    // arquivo carrega framer-motion e date-fns pela primeira vez -- medido
    // ~5,3s isolado, mas até ~12,9s quando os 30 arquivos de teste rodam em
    // paralelo (disputa de CPU/transform, mesma causa-raiz da #201). 30s dá
    // folga real; é puro custo de import, não teste lento de verdade (o
    // segundo teste, com o módulo já em cache, roda em ~20ms).
    enableReviews = false;
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );

    await act(async () => {
      raiz.render(<UserProfileView userId="user-alvo" onNavigate={() => {}} />);
    });
    // O carregamento (`loadPublicProfileData`) é assíncrono -- espera resolver.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("Produto ótimo, chegou rápido.");
    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
  }, 30000);

  it("com o flag LIGADO, a estrela da review continua exatamente como hoje", async () => {
    enableReviews = true;
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

    expect(hospedeiro.textContent).toContain("Produto ótimo, chegou rápido.");
    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
  });
});
