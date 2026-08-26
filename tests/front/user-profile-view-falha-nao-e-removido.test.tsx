// @vitest-environment jsdom
//
// Falha de rede não é "usuário foi removido", e sub-consulta que falhou não
// conta zero.
//
// Até 25/08/2026 o catch único de loadPublicProfileData deixava profile=null
// para QUALQUER erro: quem clicava no nome de um avaliador numa oscilação de
// rede lia "Usuário não encontrado... ou o usuário foi removido" — mentira
// com aparência de fato. E se só a consulta de reviews/questions falhava,
// os contadores anunciavam "0 Avaliações"/"0 Perguntas" mentirosos. Este
// teste prende os três caminhos: (a) perfil inexistente DE VERDADE continua
// dizendo não encontrado; (b) FALHA no perfil vira "Não conseguimos carregar"
// com retry e nunca "removido"; (c) falha na sub-consulta mostra "—" no
// contador em vez de zero inventado.
//
// Mock direto de @/lib/supabase pelo mesmo motivo de
// user-profile-view-gate-avaliacoes.test.tsx (client de verdade usa Web
// Worker, indisponível no jsdom). Vermelho analítico contra o HEAD: o catch
// único antigo tratava (b) exatamente como (a).
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

// O resultado da PRIMEIRA consulta (perfil) é trocado por cada teste; as
// demais tabelas respondem normais por padrão.
let resultadoDoPerfil: {
  data: unknown;
  error: { code?: string; message?: string } | null;
} = { data: perfil, error: null };
let reviewsQuebram = false;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(resultadoDoPerfil),
            }),
          }),
        };
      }
      if (tabela === "reviews") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                reviewsQuebram
                  ? Promise.reject(new Error("network down"))
                  : Promise.resolve({ data: [], error: null }),
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileView — falha de rede não é 'usuário foi removido'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    resultadoDoPerfil = { data: perfil, error: null };
    reviewsQuebram = false;
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

  async function renderizar() {
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
    return hospedeiro.textContent ?? "";
  }

  it("perfil inexistente de VERDADE (PGRST116): 'não encontrado' continua sendo dito", async () => {
    resultadoDoPerfil = {
      data: null,
      error: { code: "PGRST116", message: "0 rows" },
    };
    const texto = await renderizar();

    expect(texto).toContain("Usuário não encontrado");
    expect(texto).toContain("foi");
  });

  it("FALHA no perfil (erro qualquer): 'Não conseguimos carregar' com retry, nunca 'removido'", async () => {
    resultadoDoPerfil = {
      data: null,
      error: { message: "Network request failed" },
    };
    const texto = await renderizar();

    expect(texto).toContain("Não conseguimos carregar este perfil");
    expect(texto).toContain("Tentar de novo");
    expect(texto).not.toContain("foi");
    expect(texto).not.toContain("Usuário não encontrado");
  });

  it("perfil carregado mas reviews falhando: contador mostra '—', nunca zero inventado", async () => {
    reviewsQuebram = true;
    await renderizar();

    expect(hospedeiro.textContent).toContain("Cliente Teste");
    const rotuloAvaliacoes = [...hospedeiro.querySelectorAll("span")].find(
      (el) => el.textContent?.trim() === "Avaliações",
    );
    expect(rotuloAvaliacoes).toBeDefined();
    const numero =
      rotuloAvaliacoes!.previousElementSibling?.textContent ?? "";
    expect(numero.trim()).toBe("—");
  });
});
