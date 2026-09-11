// @vitest-environment jsdom
//
// Defeito: o selo "Compra verificada" de uma avaliação no perfil público de
// outro cliente usava `text-emerald-600`, que mede 3,58-3,77:1 contra o
// mínimo AA (4,5:1) de texto normal. `text-emerald-700` mede 5,21:1 e passa.
//
// Modelo estrutural copiado de user-profile-view-gate-avaliacoes.test.tsx
// (mesmo dublê de `@/lib/supabase` -- client de verdade usa Web Worker,
// indisponível no jsdom).
//
// ADENDO 11/09 ~06:50Z (crítico de desenho, item 5): a tela não importa
// mais `useAuth` -- lê SEMPRE pela RPC `perfil_publico_avaliacoes`. Este
// arquivo volta a não precisar de mock de `useAuth` e mocka `supabase.rpc`
// no lugar de `from("reviews")`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
  }),
}));

const perfil = {
  id: "user-alvo",
  full_name: "Cliente Teste",
  avatar_url: null,
  created_at: new Date().toISOString(),
  cover_url: null,
};

const reviewVerificadaRpc = {
  id: "review-1",
  product_id: "prod-1",
  rating: 5,
  comment: "Produto ótimo, chegou rápido.",
  created_at: new Date().toISOString(),
  helpful: 2,
  verified: true,
  merchant_reply: null,
  merchant_reply_at: null,
  produto_nome: "Produto Teste",
  produto_imagem_url: null,
};

// UserProfileView chama `supabase.from("public_profiles")...` para o perfil
// e `supabase.rpc(...)` para avaliações/perguntas.
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
    rpc: (nome: string, _args?: unknown) => {
      if (nome === "perfil_publico_avaliacoes") {
        return Promise.resolve({ data: [reviewVerificadaRpc], error: null });
      }
      if (nome === "perfil_publico_perguntas") {
        return Promise.resolve({ data: [], error: null });
      }
      throw new Error(`rpc inesperado neste teste: ${nome}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileView — selo 'Compra verificada' usa text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
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

  it("avaliação de compra verificada: o selo troca de tom", async () => {
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

    // A armadilha precisa estar de fato presente: sem o selo renderizado de
    // verdade, o par abaixo não prova nada sobre este defeito.
    expect(hospedeiro.textContent).toContain("Compra verificada");

    const divs = Array.from(hospedeiro.querySelectorAll("div"));
    const selo = divs.find(
      (el) => el.textContent?.trim() === "Compra verificada",
    );
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  }, 30000);
});
