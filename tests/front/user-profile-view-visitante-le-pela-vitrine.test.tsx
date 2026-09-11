// @vitest-environment jsdom
//
// Regra de produto do Gabriel (11/09/2026): perfil público NÃO exige login.
// A migration 20261111000000 (ainda não aplicada) tira o visitante sem
// sessão das policies de `reviews`/`questions` — a partir dela, o caminho
// antigo (`from("reviews")`/`from("questions")` filtrando por `user_id`)
// deixa de devolver linha nenhuma para `anon`.
//
// ADENDO 11/09 ~06:50Z (crítico de desenho, item 5): UM CAMINHO SÓ na tela.
// `AuthContext` hidrata `user` do cache local antes de falar com o
// servidor; uma sessão em cache com token expirado/irrecuperável cairia
// num ramo por tabela e, com a 20261111 aplicada, veria "—" PERMANENTE
// numa tela que é pública por regra de produto. Por isso a tela não importa
// mais `useAuth` — ela lê SEMPRE pelas duas funções da vitrine
// (`perfil_publico_avaliacoes`/`perfil_publico_perguntas`, que não expõem
// `user_id`), com ou sem sessão, e NUNCA toca
// `from("reviews")`/`from("questions")`. O mock de `useAuth` abaixo existe
// só para o teste de controle "com sessão TAMBÉM chama rpc()": ele força um
// usuário logado no CONTEXTO de teste para provar que a tela ignora esse
// sinal por completo (a tela em si não importa mais `useAuth` -- é o mock
// ficando sem efeito nenhum que é a prova do caminho único).
//
// Mesmo padrão de mock de user-profile-view-falha-nao-e-removido.test.tsx
// (client de verdade usa Web Worker, indisponível no jsdom).
import type { View } from "@/types";
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

// Usado só pelo teste de controle "com sessão" -- ver comentário acima.
let usuarioLogado: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));

// O resultado de cada RPC é trocado por teste; `avaliacoesRpcResultado`
// também serve para o caso de erro (contador vira "—", nunca zero).
let avaliacoesRpcResultado: {
  data: unknown;
  error: { message?: string } | null;
} = { data: [], error: null };
let perguntasRpcResultado: {
  data: unknown;
  error: { message?: string } | null;
} = { data: [], error: null };

const rpcMock = vi.fn((nome: string, _args?: unknown) => {
  if (nome === "perfil_publico_avaliacoes") {
    return Promise.resolve(avaliacoesRpcResultado);
  }
  if (nome === "perfil_publico_perguntas") {
    return Promise.resolve(perguntasRpcResultado);
  }
  throw new Error(`rpc inesperado neste teste: ${nome}`);
});

// `from` só serve para `public_profiles` (a leitura do perfil continua como
// está) e para o CONTROLE negativo: `reviews`/`questions` nunca podem ser
// chamados, com ou sem sessão simulada.
const fromMock = vi.fn((tabela: string) => {
  if (tabela === "public_profiles") {
    return {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: perfil, error: null }),
        }),
      }),
    };
  }
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => fromMock(tabela),
    rpc: (nome: string, args: unknown) => rpcMock(nome, args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A troca de aba usa `layoutId="publicProfileActiveTabLine"` (framer-motion),
// que mede layout via ResizeObserver -- ausente no jsdom. Mesmo par de
// dublês de account-settings-senha-usa-o-hook-traduzido.test.tsx.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

/** Espera até `condicao()` ficar verdadeira, um `act()` por tique -- mesmo
 * helper (e mesmo motivo) de account-settings-senha-usa-o-hook-traduzido.test.tsx:
 * um único `act()` envolvendo o laço inteiro nunca via o conteúdo da nova aba
 * assentar no DOM. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

describe("UserProfileView — a tela lê SEMPRE pela vitrine do autor (sem user_id)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    usuarioLogado = null;
    avaliacoesRpcResultado = { data: [], error: null };
    perguntasRpcResultado = { data: [], error: null };
    fromMock.mockClear();
    rpcMock.mockClear();
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

  async function renderizar(
    onNavigate: (view: View, id?: string) => void = () => {},
  ) {
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );
    await act(async () => {
      raiz.render(
        <UserProfileView userId="user-alvo" onNavigate={onNavigate} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("chama as duas RPCs com p_autor e NUNCA from('reviews')/from('questions')", async () => {
    avaliacoesRpcResultado = {
      data: [
        {
          id: "review-1",
          product_id: "prod-1",
          rating: 5,
          comment: "Ótimo produto, vim pela vitrine.",
          created_at: new Date().toISOString(),
          helpful: 3,
          verified: true,
          merchant_reply: null,
          merchant_reply_at: null,
          produto_nome: "Produto da Vitrine",
          produto_imagem_url: "https://exemplo.com/produto.png",
        },
      ],
      error: null,
    };
    perguntasRpcResultado = {
      data: [
        {
          id: "pergunta-1",
          product_id: "prod-2",
          question: "Isso serve para presente?",
          created_at: new Date().toISOString(),
          produto_nome: "Outro Produto",
          produto_imagem_url: null,
          answers: [
            {
              id: "resposta-1",
              answer: "Sim, serve muito bem.",
              created_at: new Date().toISOString(),
            },
          ],
        },
      ],
      error: null,
    };

    const texto = await renderizar();

    expect(rpcMock).toHaveBeenCalledWith("perfil_publico_avaliacoes", {
      p_autor: "user-alvo",
    });
    expect(rpcMock).toHaveBeenCalledWith("perfil_publico_perguntas", {
      p_autor: "user-alvo",
    });
    expect(fromMock).not.toHaveBeenCalledWith("reviews");
    expect(fromMock).not.toHaveBeenCalledWith("questions");

    // Avaliação com nome do produto (aba "Avaliações", que abre por padrão).
    expect(texto).toContain("Produto da Vitrine");
    expect(texto).toContain("Ótimo produto, vim pela vitrine.");

    // Pergunta com a resposta -- só aparece na aba "Perguntas"
    // (AnimatePresence mode="wait" só monta uma aba por vez).
    const botaoPerguntas = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Perguntas",
    );
    expect(botaoPerguntas).toBeDefined();
    await act(async () => {
      botaoPerguntas!.click();
    });
    await esperarAte(() =>
      (hospedeiro.textContent ?? "").includes("Isso serve para presente?"),
    );

    expect(hospedeiro.textContent).toContain("Isso serve para presente?");
    expect(hospedeiro.textContent).toContain("Sim, serve muito bem.");
  });

  it("produto ausente (produto_nome null) não quebra a renderização da avaliação", async () => {
    avaliacoesRpcResultado = {
      data: [
        {
          id: "review-sem-produto",
          product_id: "prod-removido",
          rating: 3,
          comment: "O produto que avaliei sumiu, mas minha avaliação continua.",
          created_at: new Date().toISOString(),
          helpful: 0,
          verified: false,
          merchant_reply: null,
          merchant_reply_at: null,
          produto_nome: null,
          produto_imagem_url: null,
        },
      ],
      error: null,
    };

    const texto = await renderizar();

    expect(texto).toContain(
      "O produto que avaliei sumiu, mas minha avaliação continua.",
    );
  });

  it("linha com produto_nome E product_id nulos mostra o placeholder e não dispara navegação para produto", async () => {
    // Produto inativo/apagado/inexistente: o LEFT JOIN da função devolve os
    // dois nulos juntos. A tela nunca fabrica um id a partir da review --
    // sem produto público, não há card clicável nenhum para este item.
    avaliacoesRpcResultado = {
      data: [
        {
          id: "review-produto-nao-publico",
          product_id: null,
          rating: 2,
          comment: "Avaliei um produto que a loja apagou depois.",
          created_at: new Date().toISOString(),
          helpful: 0,
          verified: false,
          merchant_reply: null,
          merchant_reply_at: null,
          produto_nome: null,
          produto_imagem_url: null,
        },
      ],
      error: null,
    };
    const onNavigate = vi.fn();

    const texto = await renderizar(onNavigate);

    expect(texto).toContain("Avaliei um produto que a loja apagou depois.");
    // Nenhum cabeçalho de produto clicável para esta review (o placeholder
    // é a ausência do card, não um card quebrado apontando para um id
    // inventado).
    expect(hospedeiro.querySelector('[role="button"]')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("erro na RPC de avaliações vira '—' no contador, nunca zero inventado", async () => {
    avaliacoesRpcResultado = {
      data: null,
      error: { message: "permission denied" },
    };

    await renderizar();

    const rotuloAvaliacoes = [...hospedeiro.querySelectorAll("span")].find(
      (el) => el.textContent?.trim() === "Avaliações",
    );
    expect(rotuloAvaliacoes).toBeDefined();
    const numero = rotuloAvaliacoes!.previousElementSibling?.textContent ?? "";
    expect(numero.trim()).toBe("—");
  });

  it("com sessão TAMBÉM chama rpc(): o mock de useAuth com usuário logado não muda nada (não há mais ramo por sessão)", async () => {
    // Força um usuário logado no mock de `useAuth` -- a tela não o importa
    // mais, então isto não deveria influenciar em nada. Se algum dia
    // reaparecer um `if (!user)`/`if (user)` na tela, este teste falha:
    // contra o `useAuth` mockado aqui, o ramo antigo chamaria
    // `from("reviews")`, e as asserções abaixo pegariam isso.
    usuarioLogado = { id: "user-alvo" };
    avaliacoesRpcResultado = {
      data: [
        {
          id: "review-1",
          product_id: "prod-1",
          rating: 4,
          comment: "Também vejo isso logado.",
          created_at: new Date().toISOString(),
          helpful: 1,
          verified: false,
          merchant_reply: null,
          merchant_reply_at: null,
          produto_nome: "Produto da Vitrine",
          produto_imagem_url: null,
        },
      ],
      error: null,
    };

    const texto = await renderizar();

    expect(rpcMock).toHaveBeenCalledWith("perfil_publico_avaliacoes", {
      p_autor: "user-alvo",
    });
    expect(fromMock).not.toHaveBeenCalledWith("reviews");
    expect(fromMock).not.toHaveBeenCalledWith("questions");
    expect(texto).toContain("Também vejo isso logado.");
  });
});
