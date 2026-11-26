// @vitest-environment jsdom
//
// Loja grande (26/11/2026): a página do produto lia TODAS as avaliações e
// TODAS as perguntas do produto de uma vez (`useReviews.getReviewsByProduct`
// e `useQuestions.getQuestionsByProduct` sem `.limit()`). Num produto com
// milhares de avaliações o aparelho da cliente baixava tudo para mostrar 10.
//
// O conserto: as duas leituras pedem um teto. As avaliações pedem uma a mais
// que o teto para saber se há mais no banco; quando há, a nota, a contagem e
// as barras vêm da contagem do banco por estrela (só as publicadas), nunca das
// 20 que a lista trouxe, e "Ver mais avaliações" busca a próxima leva. As
// perguntas não têm "ver mais" na tela: só o teto, as mais recentes primeiro.
//
// Dublê do banco: um construtor encadeável que GUARDA o que foi pedido
// (tabela, filtros, teto, contagem) e devolve as linhas que o teste escolheu.
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

type Pedido = {
  tabela: string;
  filtros: [string, unknown][];
  limite?: number;
  contagem?: { count?: string; head?: boolean };
};

const h = vi.hoisted(() => ({
  pedidos: [] as Pedido[],
  usuario: null as { id: string } | null,
  // Linhas devolvidas para a lista (avaliações ou perguntas).
  linhas: [] as Record<string, unknown>[],
  // Quantas publicadas de cada nota o banco conta (índice 0 = 1 estrela).
  porNota: [0, 0, 0, 0, 0],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const pedido: Pedido = { tabela, filtros: [] };
      h.pedidos.push(pedido);
      const builder: Record<string, unknown> = {};
      builder.select = (_campos: string, opcoes?: Pedido["contagem"]) => {
        if (opcoes) pedido.contagem = opcoes;
        return builder;
      };
      builder.eq = (coluna: string, valor: unknown) => {
        pedido.filtros.push([coluna, valor]);
        return builder;
      };
      builder.in = () => builder;
      builder.order = () => builder;
      builder.limit = (n: number) => {
        pedido.limite = n;
        return builder;
      };
      builder.abortSignal = () => builder;
      builder.maybeSingle = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: (v: unknown) => unknown) => {
        let resposta: unknown;
        if (pedido.contagem?.head) {
          const nota = pedido.filtros.find(([c]) => c === "rating")?.[1];
          resposta = {
            data: null,
            count: h.porNota.at(Number(nota) - 1) ?? 0,
            error: null,
          };
        } else if (
          tabela === "reviews" ||
          tabela === "vw_reviews_public" ||
          tabela === "questions" ||
          tabela === "vw_questions_public"
        ) {
          const linhas = h.linhas.slice(0, pedido.limite ?? h.linhas.length);
          resposta = { data: linhas, error: null };
        } else if (tabela === "vw_produtos_public") {
          resposta = {
            data: { nome: "Produto", imagem_url: null },
            error: null,
          };
        } else {
          resposta = { data: [], error: null };
        }
        return Promise.resolve(resposta).then(resolve);
      };
      return builder;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
  cachedQuestionsData: null,
  setCachedQuestionsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { AVALIACOES_POR_LEITURA, useReviews } from "@/hooks/useReviews";
import { esquecerAvaliacoesGuardadas } from "@/lib/cache-de-avaliacoes";

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

function avaliacoes(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `r${i + 1}`,
    product_id: "produto-grande",
    user_id: `u${i + 1}`,
    rating: 5,
    comment: `Comentário ${i + 1}`,
    verified: true,
    status: "publicada",
    helpful: 0,
    created_at: "2026-11-01T12:00:00Z",
    merchant_reply: null,
    author_name: "Cliente",
    author_avatar_url: null,
  }));
}

function perguntas(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `q${i + 1}`,
    product_id: "produto-grande",
    user_id: `u${i + 1}`,
    question: `Pergunta ${i + 1}`,
    created_at: "2026-11-01T12:00:00Z",
    author_name: "Cliente",
    author_avatar_url: null,
    answers: [],
  }));
}

const pedidosDaLista = (tabela: string) =>
  h.pedidos.filter((p) => p.tabela === tabela && !p.contagem?.head);
const contagens = () => h.pedidos.filter((p) => p.contagem?.head);

let raiz: Root;
let hospedeiro: HTMLDivElement;
let avaliacoesAtual: ReturnType<typeof useReviews> | undefined;
let perguntasAtual: ReturnType<typeof useQuestions> | undefined;

function Sonda() {
  const r = useReviews();
  const q = useQuestions();
  useEffect(() => {
    avaliacoesAtual = r;
    perguntasAtual = q;
  });
  return null;
}

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  esquecerAvaliacoesGuardadas();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.pedidos = [];
  h.linhas = [];
  h.porNota = [0, 0, 0, 0, 0];
  h.usuario = null;
  avaliacoesAtual = undefined;
  perguntasAtual = undefined;
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

describe("avaliações da página do produto vêm com teto", () => {
  it("o teto é 20", async () => {
    await montar();
    expect(AVALIACOES_POR_LEITURA).toBe(20);
  });

  it("visitante: pede uma a mais que o teto; com poucas, não conta no banco nem diz que há mais", async () => {
    h.linhas = avaliacoes(3);
    await montar();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });

    expect(pedidosDaLista("vw_reviews_public").at(-1)?.limite).toBe(21);
    expect(avaliacoesAtual?.reviews).toHaveLength(3);
    expect(contagens()).toHaveLength(0);
    expect(avaliacoesAtual?.resumoDasAvaliacoes).toBeNull();
  });

  it("cliente logada: a leitura da tabela também tem teto", async () => {
    h.usuario = { id: "cliente-ficticia" };
    h.linhas = avaliacoes(3);
    await montar();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });

    expect(pedidosDaLista("reviews").at(-1)?.limite).toBe(21);
  });

  it("produto com mais que o teto: a lista fica em 20 e a nota vem da contagem do banco por estrela", async () => {
    h.linhas = avaliacoes(21);
    h.porNota = [1, 0, 0, 999, 2000];
    await montar();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });

    expect(avaliacoesAtual?.reviews).toHaveLength(20);
    expect(avaliacoesAtual?.resumoDasAvaliacoes).toEqual({
      productId: "produto-grande",
      temMais: true,
      porNota: [1, 0, 0, 999, 2000],
    });
    // Cinco contagens sem linhas (head), uma por estrela, só do produto.
    expect(contagens()).toHaveLength(5);
    for (const pedido of contagens()) {
      expect(pedido.tabela).toBe("vw_reviews_public");
      expect(pedido.contagem).toEqual({ count: "exact", head: true });
      expect(pedido.filtros).toContainEqual(["product_id", "produto-grande"]);
    }
  });

  it("cliente logada: a contagem do banco só soma as publicadas (a pendente fica fora da nota)", async () => {
    h.usuario = { id: "cliente-ficticia" };
    h.linhas = avaliacoes(21);
    h.porNota = [0, 0, 0, 0, 30];
    await montar();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });

    expect(contagens()).toHaveLength(5);
    for (const pedido of contagens()) {
      expect(pedido.tabela).toBe("reviews");
      expect(pedido.filtros).toContainEqual(["status", "publicada"]);
    }
  });

  it("'ver mais' pede a próxima leva: o teto sobe 20", async () => {
    h.linhas = avaliacoes(45);
    h.porNota = [0, 0, 0, 0, 45];
    await montar();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });
    await act(async () => {
      await avaliacoesAtual?.carregarMaisAvaliacoes("produto-grande");
    });

    expect(pedidosDaLista("vw_reviews_public").at(-1)?.limite).toBe(41);
    expect(avaliacoesAtual?.reviews).toHaveLength(40);
    expect(avaliacoesAtual?.resumoDasAvaliacoes?.temMais).toBe(true);
  });
});

describe("perguntas da página do produto vêm com teto", () => {
  it("visitante: as 20 mais recentes", async () => {
    h.linhas = perguntas(30);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(20);
    expect(perguntasAtual?.questions).toHaveLength(20);
  });

  it("cliente logada: as 20 mais recentes", async () => {
    h.usuario = { id: "cliente-ficticia" };
    h.linhas = perguntas(30);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(pedidosDaLista("questions").at(-1)?.limite).toBe(20);
    expect(perguntasAtual?.questions).toHaveLength(20);
  });
});
