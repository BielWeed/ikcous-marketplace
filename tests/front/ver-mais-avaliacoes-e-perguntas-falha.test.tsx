// @vitest-environment jsdom
//
// "Ver mais" com internet fraca (26/11/2026): o "Ver mais avaliações" e o
// "Ver mais perguntas" buscavam a próxima leva no modo silencioso, que desliga
// o erro e o toast. Se a leitura falhava, a cliente tocava o botão e nada
// acontecia, sem nenhum aviso; e o botão das avaliações nem mostrava que
// estava buscando. Pior: se a contagem por estrela falhava nessa releitura, o
// resumo ia vazio para a tela e as barras de estrelas sumiam, embora a
// contagem certa anterior do mesmo produto continuasse guardada.
//
// O conserto: a falha do "Ver mais" avisa por toast e mantém a lista na tela;
// o botão das avaliações trava e diz que está carregando durante a busca; e a
// contagem que falha numa releitura reaproveita a guardada do mesmo produto.
//
// Dublê do banco copiado de avaliacoes-e-perguntas-da-vitrine-com-limite; o
// harness da página do produto, de product-view-produto-com-muitas-avaliacoes.
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
  linhas: [] as Record<string, unknown>[],
  porNota: [0, 0, 0, 0, 5],
  // Liga a falha da leitura da lista (avaliações e perguntas) ou da contagem.
  listaFalha: false,
  contagemFalha: false,
  // Com portão, a lista só responde quando o teste abrir: é a resposta "em voo".
  portao: null as Promise<void> | null,
  // Quando preenchido, a página do produto recebe este hook no lugar do real.
  reviewsFalso: null as Record<string, unknown> | null,
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
          resposta = h.contagemFalha
            ? { data: null, count: null, error: { message: "Failed to fetch" } }
            : {
                data: null,
                count: h.porNota.at(Number(nota) - 1) ?? 0,
                error: null,
              };
        } else if (
          tabela === "vw_reviews_public" ||
          tabela === "vw_questions_public"
        ) {
          const linhas = h.linhas.slice(0, pedido.limite ?? h.linhas.length);
          const falha = h.listaFalha;
          const portao = h.portao;
          const responder = () =>
            falha
              ? { data: null, error: { message: "Failed to fetch" } }
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
  useAuth: () => ({ user: null, isAdmin: false }),
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
vi.mock("@/hooks/useReviews", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useReviews")>();
  return {
    ...real,
    useReviews: () => h.reviewsFalso ?? real.useReviews(),
  };
});
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import { esquecerAvaliacoesGuardadas } from "@/lib/cache-de-avaliacoes";
import type { Product, Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

let raiz: Root;
let hospedeiro: HTMLElement;
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

async function montarSonda() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

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

const mensagensDeErro = () =>
  vi.mocked(toast.error).mock.calls.map((chamada) => chamada[0]);

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  esquecerAvaliacoesGuardadas();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(toast.error).mockClear();
  h.pedidos = [];
  h.linhas = [];
  h.porNota = [0, 0, 0, 0, 5];
  h.listaFalha = false;
  h.contagemFalha = false;
  h.portao = null;
  h.reviewsFalso = null;
  avaliacoesAtual = undefined;
  perguntasAtual = undefined;
  hospedeiro = document.createElement("main");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.getElementById("product-structured-data")?.remove();
  esquecerAvaliacoesGuardadas();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("'Ver mais avaliações' com internet fraca", () => {
  it("a leitura falha: avisa por toast e a lista que já estava na tela continua", async () => {
    h.linhas = avaliacoes(45);
    await montarSonda();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });
    expect(avaliacoesAtual?.reviews).toHaveLength(20);

    h.listaFalha = true;
    await act(async () => {
      await avaliacoesAtual?.carregarMaisAvaliacoes("produto-grande");
    });

    expect(mensagensDeErro()).toEqual([
      "Não foi possível carregar mais avaliações. Tente de novo.",
    ]);
    expect(avaliacoesAtual?.reviews).toHaveLength(20);
    expect(avaliacoesAtual?.erroDaListagemProduto).toBeNull();
  });

  it("enquanto busca, o hook diz que está carregando mais; ao terminar, deixa de dizer", async () => {
    h.linhas = avaliacoes(45);
    await montarSonda();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });
    expect(avaliacoesAtual?.carregandoMaisAvaliacoes).toBe(false);

    const abrir = segurarRespostas();
    let mais: Promise<void> | undefined;
    await act(async () => {
      mais = avaliacoesAtual?.carregarMaisAvaliacoes("produto-grande");
    });
    expect(avaliacoesAtual?.carregandoMaisAvaliacoes).toBe(true);

    await act(async () => {
      abrir();
      await mais;
    });
    expect(avaliacoesAtual?.carregandoMaisAvaliacoes).toBe(false);
    expect(avaliacoesAtual?.reviews).toHaveLength(40);
  });

  it("a contagem por estrela falha na releitura: as barras ficam com os números de antes", async () => {
    h.linhas = avaliacoes(45);
    h.porNota = [3, 0, 0, 7, 35];
    await montarSonda();
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-grande");
    });
    expect(avaliacoesAtual?.resumoDasAvaliacoes?.porNota).toEqual([
      3, 0, 0, 7, 35,
    ]);

    h.contagemFalha = true;
    await act(async () => {
      await avaliacoesAtual?.carregarMaisAvaliacoes("produto-grande");
    });

    expect(avaliacoesAtual?.reviews).toHaveLength(40);
    expect(avaliacoesAtual?.resumoDasAvaliacoes).toEqual({
      productId: "produto-grande",
      temMais: true,
      porNota: [3, 0, 0, 7, 35],
    });
  });

  it("primeira carga sem contagem guardada: a contagem que falha segue vazia (a tela usa o catálogo)", async () => {
    h.linhas = avaliacoes(45);
    h.contagemFalha = true;
    await montarSonda();
    // O resumo guardado vive no módulo e é por produto: este nunca foi lido.
    await act(async () => {
      await avaliacoesAtual?.getReviewsByProduct("produto-nunca-lido");
    });

    expect(avaliacoesAtual?.resumoDasAvaliacoes).toEqual({
      productId: "produto-nunca-lido",
      temMais: true,
      porNota: null,
    });
  });
});

describe("'Ver mais perguntas' com internet fraca", () => {
  it("a leitura falha: avisa por toast e a lista que já estava na tela continua", async () => {
    h.linhas = perguntas(45);
    await montarSonda();
    await act(async () => {
      await perguntasAtual?.getQuestionsByProduct("produto-grande");
    });
    expect(perguntasAtual?.questions).toHaveLength(20);

    h.listaFalha = true;
    await act(async () => {
      await perguntasAtual?.carregarMaisPerguntas("produto-grande");
    });

    expect(mensagensDeErro()).toEqual([
      "Não foi possível carregar mais perguntas. Tente de novo.",
    ]);
    expect(perguntasAtual?.questions).toHaveLength(20);
    expect(perguntasAtual?.error).toBeNull();
    expect(perguntasAtual?.carregandoMaisPerguntas).toBe(false);
  });
});

describe("página do produto: o botão 'Ver mais avaliações' durante a busca", () => {
  const produto: Product = {
    id: "produto-grande",
    name: "Produto Muito Avaliado",
    description: "Descrição de teste",
    price: 50,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 5,
    reviewCount: 45,
  };

  const vinte: Review[] = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i + 1}`,
    productId: "produto-grande",
    customerName: `Cliente ${i + 1}`,
    rating: 5,
    comment: `Comentário ${i + 1}`,
    verified: true,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    status: "publicada",
  }));

  function hookFalso(carregandoMaisAvaliacoes: boolean) {
    return {
      reviews: vinte,
      resumoDasAvaliacoes: {
        productId: "produto-grande",
        temMais: true,
        porNota: [0, 0, 0, 0, 45],
      },
      carregandoMaisAvaliacoes,
      carregarMaisAvaliacoes: vi.fn(),
      userIdAtual: undefined,
      loading: false,
      getReviewsByProduct: vi.fn(),
      markHelpful: vi.fn(),
      subscribeToReviews: vi.fn(() => () => {}),
    };
  }

  async function montarPagina() {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const ultimoBotaoDasAvaliacoes = () =>
    Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("#reviews-section button"),
    ).at(-1);

  it("buscando: o botão fica travado e diz que está carregando", async () => {
    h.reviewsFalso = hookFalso(true);
    await montarPagina();

    const botao = ultimoBotaoDasAvaliacoes();
    expect(botao?.textContent).toContain("Carregando");
    expect(botao?.textContent).not.toContain("Ver mais avaliações");
    expect(botao?.disabled).toBe(true);
    expect(botao?.getAttribute("aria-busy")).toBe("true");
  });

  it("parado: o botão volta a 'Ver mais avaliações' e aceita o toque", async () => {
    h.reviewsFalso = hookFalso(false);
    await montarPagina();

    const botao = ultimoBotaoDasAvaliacoes();
    expect(botao?.textContent).toContain("Ver mais avaliações");
    expect(botao?.disabled).toBe(false);
  });
});
