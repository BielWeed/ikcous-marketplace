// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026): a lista de avaliações da página do produto
// para quem está LOGADA lê a tabela `reviews` direto (o visitante lê a vitrine
// pública, já coberta). Nenhum teste lia o pedido dessa consulta: trocar a
// ordem para "da mais antiga para a mais nova" mantinha a suíte verde, e a
// cliente passaria a ver primeiro a avaliação de anos atrás. Aqui o dublê do
// banco APLICA o filtro por produto e a ordem pedida, e o teste lê o que o hook
// entrega (entrada = linhas cruas; conclusão = a lista do hook).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";
import { esquecerAvaliacoesGuardadas } from "@/lib/cache-de-avaliacoes";

vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  ordenacoes: [] as [string, { ascending: boolean }][],
  tabelas: [] as string[],
  linhas: [
    {
      id: "antiga",
      product_id: "produto-a",
      user_id: "u-1",
      rating: 3,
      comment: "Comprei no ano passado",
      created_at: "2025-03-01T12:00:00.000Z",
      helpful: 1,
      verified: true,
      status: "publicada",
      merchant_reply: null,
      user: { nome_publico: "Ana S.", avatar_url: "https://x.test/a.png" },
    },
    {
      id: "recente",
      product_id: "produto-a",
      user_id: "u-2",
      rating: 5,
      comment: "Chegou ontem",
      created_at: "2026-11-23T12:00:00.000Z",
      helpful: 0,
      verified: false,
      status: "pendente",
      merchant_reply: "Obrigada!",
      user: null,
    },
    {
      id: "meio",
      product_id: "produto-a",
      user_id: "u-3",
      rating: 4,
      comment: "Faz tempo",
      created_at: "2026-06-15T12:00:00.000Z",
      helpful: 2,
      verified: true,
      status: "publicada",
      merchant_reply: null,
      user: { nome_publico: "Bia L.", avatar_url: null },
    },
    {
      id: "de-outro-produto",
      product_id: "produto-b",
      user_id: "u-4",
      rating: 1,
      comment: "Outro produto",
      created_at: "2026-11-24T12:00:00.000Z",
      helpful: 0,
      verified: false,
      status: "publicada",
      merchant_reply: null,
      user: { nome_publico: "Caio M.", avatar_url: null },
    },
  ],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      h.tabelas.push(tabela);
      if (tabela !== "reviews" && tabela !== "review_votes") {
        throw new Error(`Consulta inesperada: ${tabela}`);
      }
      let linhas = tabela === "reviews" ? [...h.linhas] : [];
      const builder = {
        select: () => builder,
        eq: (coluna: string, valor: unknown) => {
          if (tabela === "reviews") {
            linhas = linhas.filter(
              (linha) => linha[coluna as keyof typeof linha] === valor,
            );
          }
          return builder;
        },
        in: () => Promise.resolve({ data: [], error: null }),
        order: (coluna: string, opcoes: { ascending: boolean }) => {
          h.ordenacoes.push([coluna, opcoes]);
          linhas.sort((a, b) =>
            opcoes.ascending
              ? a.created_at.localeCompare(b.created_at)
              : b.created_at.localeCompare(a.created_at),
          );
          return builder;
        },
        limit: () => Promise.resolve({ data: linhas, error: null }),
      };
      return builder;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-ficticia" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => armazem.clear(),
    key: (indice: number) => [...armazem.keys()].at(indice) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("cliente logada lê as avaliações do produto direto da tabela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useReviews> | undefined;

  function Sonda() {
    const retorno = useReviews();
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  beforeEach(async () => {
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    esquecerAvaliacoesGuardadas();
    atual = undefined;
    h.ordenacoes = [];
    h.tabelas = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    esquecerAvaliacoesGuardadas();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pede da mais recente para a mais antiga e entrega só as do produto aberto", async () => {
    await act(async () => {
      await atual?.getReviewsByProduct("produto-a");
    });

    expect(h.ordenacoes).toContainEqual(["created_at", { ascending: false }]);
    expect(atual?.reviews.map((r) => r.id)).toEqual([
      "recente",
      "meio",
      "antiga",
    ]);
  });

  it("autora sem perfil público aparece como 'Cliente'; com perfil, o nome e a foto vêm do perfil", async () => {
    await act(async () => {
      await atual?.getReviewsByProduct("produto-a");
    });

    const porId = Object.fromEntries(
      (atual?.reviews ?? []).map((r) => [r.id, r]),
    );
    expect(porId.recente.customerName).toBe("Cliente");
    expect(porId.recente.customerAvatar).toBeUndefined();
    expect(porId.antiga.customerName).toBe("Ana S.");
    expect(porId.antiga.customerAvatar).toBe("https://x.test/a.png");
    // Perfil sem foto: nada de texto vazio no lugar do endereço da imagem.
    expect(porId.meio.customerAvatar).toBeUndefined();
  });

  it("a situação, o selo, os votos e a resposta da loja chegam como o banco guardou", async () => {
    await act(async () => {
      await atual?.getReviewsByProduct("produto-a");
    });

    const porId = Object.fromEntries(
      (atual?.reviews ?? []).map((r) => [r.id, r]),
    );
    expect(porId.recente).toMatchObject({
      status: "pendente",
      verified: false,
      helpful: 0,
      merchantReply: "Obrigada!",
      userId: "u-2",
    });
    expect(porId.antiga).toMatchObject({
      status: "publicada",
      verified: true,
      helpful: 1,
    });
  });
});
