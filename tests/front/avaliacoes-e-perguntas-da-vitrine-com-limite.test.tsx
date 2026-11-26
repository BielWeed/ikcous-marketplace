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
// perguntas seguem o mesmo padrão (pedem 21): "Ver mais perguntas" relê com um
// teto 20 maior, e a resposta velha (outro produto, outra conta, segundo
// clique) nunca governa a tela.
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
  sinal?: AbortSignal;
};

const h = vi.hoisted(() => ({
  pedidos: [] as Pedido[],
  usuario: null as { id: string } | null,
  // Linhas devolvidas para a lista (avaliações ou perguntas).
  linhas: [] as Record<string, unknown>[],
  // Quantas publicadas de cada nota o banco conta (índice 0 = 1 estrela).
  porNota: [0, 0, 0, 0, 0],
  // Linhas por produto (quando o teste precisa de dois produtos diferentes).
  linhasPorProduto: new Map<string, Record<string, unknown>[]>(),
  // Com portão, a lista só responde quando o teste abrir: é a resposta "em voo".
  portao: null as Promise<void> | null,
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
      builder.abortSignal = (sinal: AbortSignal) => {
        pedido.sinal = sinal;
        return builder;
      };
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
          const produto = String(
            pedido.filtros.find(([c]) => c === "product_id")?.[1],
          );
          const todas = h.linhasPorProduto.get(produto) ?? h.linhas;
          const linhas = todas.slice(0, pedido.limite ?? todas.length);
          const portao = h.portao;
          // Como o supabase-js: a leitura cancelada volta com erro de "aborted".
          const responder = () =>
            pedido.sinal?.aborted
              ? {
                  data: null,
                  error: { name: "AbortError", message: "aborted" },
                }
              : { data: linhas, error: null };
          resposta = portao ? portao.then(responder) : responder();
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

import { PERGUNTAS_POR_LEITURA, useQuestions } from "@/hooks/useQuestions";
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

function perguntas(quantas: number, produto = "produto-grande") {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `${produto}-q${i + 1}`,
    product_id: produto,
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

// Fecha o portão: as leituras da lista ficam em voo até `abrir()`.
function segurarRespostas() {
  let abrir = () => {};
  h.portao = new Promise<void>((resolve) => {
    abrir = resolve;
  });
  return () => {
    h.portao = null;
    abrir();
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  esquecerAvaliacoesGuardadas();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.pedidos = [];
  h.linhas = [];
  h.porNota = [0, 0, 0, 0, 0];
  h.linhasPorProduto = new Map();
  h.portao = null;
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
  it("o teto é 20", () => {
    expect(PERGUNTAS_POR_LEITURA).toBe(20);
  });

  it("visitante: pede uma a mais que o teto, mostra as 20 mais recentes e diz que há mais", async () => {
    h.linhas = perguntas(30);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(21);
    expect(perguntasAtual?.questions).toHaveLength(20);
    expect(perguntasAtual?.haMaisPerguntas).toBe(true);
  });

  it("cliente logada: pede uma a mais que o teto e mostra as 20 mais recentes", async () => {
    h.usuario = { id: "cliente-ficticia" };
    h.linhas = perguntas(30);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(pedidosDaLista("questions").at(-1)?.limite).toBe(21);
    expect(perguntasAtual?.questions).toHaveLength(20);
    expect(perguntasAtual?.haMaisPerguntas).toBe(true);
  });

  it("exatamente 20 no banco: não há mais", async () => {
    h.linhas = perguntas(20);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(perguntasAtual?.questions).toHaveLength(20);
    expect(perguntasAtual?.haMaisPerguntas).toBe(false);
  });

  it("'ver mais' relê com o teto 20 maior até a última pergunta", async () => {
    h.linhas = perguntas(45);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(41);
    expect(perguntasAtual?.questions).toHaveLength(40);
    expect(perguntasAtual?.haMaisPerguntas).toBe(true);

    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(61);
    expect(perguntasAtual?.questions).toHaveLength(45);
    expect(perguntasAtual?.haMaisPerguntas).toBe(false);
  });

  it("cliente logada: 'ver mais' também sobe o teto da tabela", async () => {
    h.usuario = { id: "cliente-ficticia" };
    h.linhas = perguntas(30);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });

    expect(pedidosDaLista("questions").at(-1)?.limite).toBe(41);
    expect(perguntasAtual?.questions).toHaveLength(30);
    expect(perguntasAtual?.haMaisPerguntas).toBe(false);
  });

  it("dois cliques seguidos: uma leitura só, o teto sobe uma vez e o estado de carregando acompanha", async () => {
    h.linhas = perguntas(45);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    const antes = pedidosDaLista("vw_questions_public").length;

    const abrir = segurarRespostas();
    let primeiro: Promise<void> | undefined;
    let segundo: Promise<void> | undefined;
    await act(async () => {
      primeiro = perguntasAtual?.carregarMaisPerguntas("produto-grande");
      segundo = perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });
    expect(perguntasAtual?.carregandoMaisPerguntas).toBe(true);

    await act(async () => {
      abrir();
      await Promise.all([primeiro, segundo]);
    });

    const depois = pedidosDaLista("vw_questions_public").slice(antes);
    expect(depois.map((p) => p.limite)).toEqual([41]);
    expect(perguntasAtual?.questions).toHaveLength(40);
    expect(perguntasAtual?.carregandoMaisPerguntas).toBe(false);
  });

  it("'ver mais' de outro produto é ignorado", async () => {
    h.linhas = perguntas(45);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    const antes = h.pedidos.length;
    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("outro-produto");
    });

    expect(h.pedidos.length).toBe(antes);
    expect(perguntasAtual?.questions).toHaveLength(20);
  });

  it("trocar de produto com o 'ver mais' em voo: a resposta velha não governa e o teto volta a 21", async () => {
    h.linhasPorProduto = new Map([
      ["produto-grande", perguntas(45, "produto-grande")],
      ["produto-pequeno", perguntas(3, "produto-pequeno")],
    ]);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    const abrir = segurarRespostas();
    let mais: Promise<void> | undefined;
    let outro: Promise<void> | undefined;
    await act(async () => {
      mais = perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });
    await act(async () => {
      outro = perguntasAtual?.getQuestionsByProduct("produto-pequeno");
    });
    await act(async () => {
      abrir();
      await Promise.all([mais, outro]);
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(21);
    expect(perguntasAtual?.questions.map((q) => q.productId)).toEqual([
      "produto-pequeno",
      "produto-pequeno",
      "produto-pequeno",
    ]);
    expect(perguntasAtual?.haMaisPerguntas).toBe(false);
    expect(perguntasAtual?.carregandoMaisPerguntas).toBe(false);
  });

  it("voltar ao produto grande depois de outro: começa de novo nas 20", async () => {
    h.linhasPorProduto = new Map([
      ["produto-grande", perguntas(45, "produto-grande")],
      ["produto-pequeno", perguntas(3, "produto-pequeno")],
    ]);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-pequeno");
    });
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    expect(pedidosDaLista("vw_questions_public").at(-1)?.limite).toBe(21);
    expect(perguntasAtual?.questions).toHaveLength(20);
    expect(perguntasAtual?.haMaisPerguntas).toBe(true);
  });

  it("trocar de conta com o 'ver mais' em voo: a leitura da conta velha não governa e o teto volta a 21", async () => {
    h.linhas = perguntas(45);
    await montar();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });

    const abrir = segurarRespostas();
    let mais: Promise<void> | undefined;
    await act(async () => {
      mais = perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });
    // Entrou na conta: o hook ganha um getQuestionsByProduct novo, e a página
    // relê o mesmo produto pela tabela.
    h.usuario = { id: "cliente-ficticia" };
    await act(async () => {
      raiz.render(<Sonda />);
    });
    let daConta: Promise<void> | undefined;
    await act(async () => {
      daConta = perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    await act(async () => {
      abrir();
      await Promise.all([mais, daConta]);
    });

    expect(pedidosDaLista("questions").at(-1)?.limite).toBe(21);
    expect(perguntasAtual?.questions).toHaveLength(20);
    // A visão logada traz o autor; a pública (da leitura velha) não.
    expect(perguntasAtual?.questions[0]?.userId).toBe("u1");
    expect(perguntasAtual?.haMaisPerguntas).toBe(true);
    expect(perguntasAtual?.carregandoMaisPerguntas).toBe(false);
  });
});
