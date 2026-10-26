// @vitest-environment jsdom
//
// Perfil público: (1) se a consulta de avaliações/perguntas falha, o corpo
// não pode dizer "Nenhuma avaliação"/"Nenhuma pergunta" (mentira: a pessoa
// pode ter vários) -- mostra "Não conseguimos carregar" com "Tentar de novo";
// (2) perfil aberto sem identificador não pode ficar no esqueleto para
// sempre -- cai em "Usuário não encontrado".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const perfil = {
  id: "user-alvo",
  full_name: "Cliente Teste",
  avatar_url: null,
  created_at: new Date().toISOString(),
  cover_url: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: perfil, error: null }),
        }),
      }),
    }),
    rpc: (nome: string) =>
      nome === "perfil_publico_avaliacoes" ||
      nome === "perfil_publico_perguntas"
        ? Promise.reject(new Error("network down"))
        : Promise.reject(new Error(`rpc inesperado: ${nome}`)),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileView — lista que falhou e perfil sem id", () => {
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

  async function renderizar(userId: string) {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );
    await act(async () => {
      raiz.render(<UserProfileView userId={userId} onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("avaliações falharam: aviso de erro com 'Tentar de novo', não 'Nenhuma avaliação'", async () => {
    const texto = await renderizar("user-alvo");
    expect(texto).toContain("Não conseguimos carregar");
    expect(texto).toContain("Tentar de novo");
    expect(texto).not.toContain("Nenhuma avaliação");
  });

  it("perguntas falharam: aviso de erro, não 'Nenhuma pergunta'", async () => {
    await renderizar("user-alvo");
    const aba = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Perguntas",
    );
    await act(async () => {
      aba!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Não conseguimos carregar");
    expect(texto).not.toContain("Nenhuma pergunta");
  });

  it("userId vazio: 'Usuário não encontrado', não esqueleto eterno", async () => {
    const texto = await renderizar("");
    expect(texto).toContain("Usuário não encontrado");
    expect(texto).toContain("Voltar para o Início");
  });
});
