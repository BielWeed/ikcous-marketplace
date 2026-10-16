// @vitest-environment jsdom
// O hook e o card são reais: só a rede é dublada. A RPC void pode aceitar
// um voto repetido sem somar nada; a tela precisa seguir a leitura do banco.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  usuario: { id: "pessoa-a" } as { id: string } | null,
  contador: 2,
  votos: new Set<string>(),
  lerVotos: vi.fn(),
  reler: vi.fn(),
  rpc: vi.fn(),
  filtros: vi.fn(),
}));

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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/LazyImage", () => ({ LazyImage: () => null }));
vi.mock("@/components/ui/custom/StarRating", () => ({
  StarRating: () => null,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      let usuario: string | undefined;
      let produto = "produto-inventado";
      const builder = {
        select: (colunas: string) => {
          h.filtros(tabela, "select", colunas);
          return builder;
        },
        eq: (coluna: string, valor: string) => {
          h.filtros(tabela, coluna, valor);
          if (coluna === "user_id") usuario = valor;
          if (coluna === "product_id") produto = valor;
          return builder;
        },
        in: (coluna: string, ids: string[]) => {
          h.filtros(tabela, coluna, ids);
          return h.lerVotos(usuario, ids);
        },
        order: async () => ({
          data: [
            {
              id: "avaliacao-inventada",
              product_id: produto,
              user_id: "autora-inventada",
              user: { full_name: "Autora fictícia" },
              author_name: "Autora fictícia",
              rating: 5,
              comment: "Avaliação fictícia",
              helpful: h.contador,
              verified: false,
              status: "publicada",
              created_at: "2026-10-01T12:00:00Z",
            },
          ],
          error: null,
        }),
        single: () => h.reler(),
      };
      return builder;
    },
    rpc: (nome: string, args: unknown) => h.rpc(nome, args),
  },
}));

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { useReviews } from "@/hooks/useReviews";
import {
  esquecerAvaliacoesGuardadas,
  getReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import { toast } from "sonner";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUTO = "produto-inventado";
const AVALIACAO = "avaliacao-inventada";
const CHAVE = `ikcous_reviews_cache_${PRODUTO}`;
type Metodos = ReturnType<typeof useReviews>;
const capturar = vi.fn<(id: number, metodos: Metodos) => void>();

function Sonda({
  id,
  produto,
  montagem,
}: { id: number; produto: string; montagem: number }) {
  const metodos = useReviews();
  const { getReviewsByProduct } = metodos;
  useEffect(() => {
    capturar(id, metodos);
  }, [id, metodos]);
  useEffect(() => {
    void getReviewsByProduct(produto);
  }, [getReviewsByProduct, produto]);
  return metodos.reviews.map((review) => (
    <ReviewCard
      key={`${review.id}:${montagem}`}
      review={review}
      jaVotou={metodos.votosUteis.has(review.id)}
      onHelpful={metodos.markHelpful}
    />
  ));
}

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

// O localStorage experimental do Node pode sobrepor o do jsdom. O dublê
// reproduz memória e persistência sem depender dessa variação do ambiente.
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
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("voto útil segue o servidor ao remontar", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.usuario = { id: "pessoa-a" };
    h.contador = 2;
    h.votos.clear();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    esquecerAvaliacoesGuardadas();
    h.lerVotos.mockImplementation(async (usuario: string, ids: string[]) => ({
      data: ids
        .filter((id) => h.votos.has(`${usuario}:${id}`))
        .map((review_id) => ({ review_id })),
      error: null,
    }));
    h.reler.mockImplementation(async () => ({
      data: { helpful: h.contador },
      error: null,
    }));
    h.rpc.mockImplementation(async () => {
      const chave = `${h.usuario?.id}:${AVALIACAO}`;
      if (!h.votos.has(chave)) {
        h.votos.add(chave);
        h.contador++;
      }
      return { error: null };
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    esquecerAvaliacoesGuardadas();
    vi.unstubAllGlobals();
  });

  async function montar({
    quantidade = 1,
    montagem = 0,
    produto = PRODUTO,
  } = {}) {
    await act(async () => {
      raiz.render(
        Array.from({ length: quantidade }, (_, id) => (
          <Sonda key={id} id={id} produto={produto} montagem={montagem} />
        )),
      );
    });
  }

  function metodos(id = 0) {
    const chamada = capturar.mock.calls
      .filter(([sonda]) => sonda === id)
      .at(-1);
    if (!chamada) throw new Error("Hook não capturado");
    return chamada[1];
  }

  function botao(id = 0) {
    return host.querySelectorAll("button").item(id);
  }

  it("voto novo grava no estado, memória e localStorage exatamente o contador relido", async () => {
    await montar();
    h.rpc.mockImplementationOnce(async () => {
      h.votos.add(`pessoa-a:${AVALIACAO}`);
      h.contador = 7; // Outros votos chegaram entre a leitura e o clique.
      return { error: null };
    });
    await act(async () => {
      botao().click();
    });
    expect(botao().textContent).toContain("Útil (7)");
    expect(botao().disabled).toBe(true);
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(7);
    expect(JSON.parse(localStorage.getItem(CHAVE)!)[0].helpful).toBe(7);
    expect(h.filtros).toHaveBeenCalledWith("reviews", "select", "helpful");
  });

  it("remontar o card e depois o hook conserva a marcação lida do servidor", async () => {
    h.votos.add(`pessoa-a:${AVALIACAO}`);
    await montar();
    expect(botao().disabled).toBe(true);
    await montar({ montagem: 1 });
    expect(botao().disabled).toBe(true);
    await act(async () => {
      raiz.render(null);
    });
    await montar();
    expect(botao().disabled).toBe(true);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.filtros).toHaveBeenCalledWith(
      "review_votes",
      "user_id",
      "pessoa-a",
    );
    expect(h.filtros).toHaveBeenCalledWith("review_votes", "review_id", [
      AVALIACAO,
    ]);
  });

  it("RPC de voto duplicado é sucesso, mas não soma 1", async () => {
    h.votos.add(`pessoa-a:${AVALIACAO}`);
    h.lerVotos.mockResolvedValueOnce({ data: [], error: null });
    await montar(); // A leitura antecedeu a confirmação de outro card/aba.
    await act(async () => {
      botao().click();
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(botao().textContent).toContain("Útil (2)");
    expect(botao().disabled).toBe(true);
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(2);
  });

  it("duas instâncias com a mesma lista não inventam um segundo voto", async () => {
    await montar({ quantidade: 2 });
    await act(async () => {
      botao(0).click();
    });
    await act(async () => {
      botao(1).click();
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.contador).toBe(3);
    expect(botao(0).textContent).toContain("Útil (3)");
    expect(botao(1).textContent).toContain("Útil (3)");
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(3);
  });

  it("dois toques e duas chamadas diretas em voo não repetem a RPC nem persistem +1", async () => {
    await montar();
    const rpc = pendente<{ error: null }>();
    const leitura = pendente<{ data: { helpful: number }; error: null }>();
    h.rpc.mockReturnValueOnce(rpc.promessa);
    h.reler.mockReturnValueOnce(leitura.promessa);
    await act(async () => {
      botao().click();
      botao().click();
      expect(await metodos().markHelpful(AVALIACAO)).toBe(false);
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(botao().disabled).toBe(true);
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(2);
    await act(async () => {
      rpc.resolver({ error: null });
    });
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain("Útil (2)");
    expect(JSON.parse(localStorage.getItem(CHAVE)!)[0].helpful).toBe(2);
    await act(async () => {
      leitura.resolver({ data: { helpful: 3 }, error: null });
    });
    expect(botao().textContent).toContain("Útil (3)");
  });

  it("falha da RPC mantém o contador confirmado e destrava para tentar novamente", async () => {
    h.rpc.mockResolvedValueOnce({ error: { message: "falha fictícia" } });
    await montar();
    await act(async () => {
      botao().click();
    });
    expect(botao().textContent).toContain("Útil (2)");
    expect(botao().disabled).toBe(false);
    expect(h.reler).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Erro ao marcar como útil.");
    await act(async () => {
      botao().click();
    });
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain("Útil (3)");
  });

  it.each([false, true])(
    "falha da releitura após sucesso não desfaz o voto (rejeição: %s)",
    async (rejeitar) => {
      await montar();
      if (rejeitar) h.reler.mockRejectedValueOnce(new Error("rede fictícia"));
      else
        h.reler.mockResolvedValueOnce({
          data: null,
          error: { message: "rede fictícia" },
        });
      await act(async () => {
        botao().click();
      });
      expect(h.contador).toBe(3);
      expect(botao().textContent).toContain("Útil (2)");
      expect(botao().disabled).toBe(true);
      expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(2);
      expect(JSON.parse(localStorage.getItem(CHAVE)!)[0].helpful).toBe(2);
      expect(toast.error).not.toHaveBeenCalledWith("Erro ao marcar como útil.");
      await montar({ montagem: 1 });
      expect(botao().disabled).toBe(true);
    },
  );

  it.each(["rpc", "releitura"])(
    "troca de conta durante %s ignora resposta atrasada no estado e cache",
    async (etapa) => {
      await montar();
      const rpc = pendente<{ error: null }>();
      const leitura = pendente<{ data: { helpful: number }; error: null }>();
      if (etapa === "rpc") h.rpc.mockReturnValueOnce(rpc.promessa);
      else h.reler.mockReturnValueOnce(leitura.promessa);
      await act(async () => {
        botao().click();
      });
      h.usuario = { id: "pessoa-b" };
      esquecerAvaliacoesGuardadas();
      await montar();
      const cacheDaOutraConta = localStorage.getItem(CHAVE);
      await act(async () => {
        rpc.resolver({ error: null });
        leitura.resolver({ data: { helpful: 99 }, error: null });
      });
      expect(localStorage.getItem(CHAVE)).toBe(cacheDaOutraConta);
      expect(botao().disabled).toBe(false);
      expect(metodos().votosUteis.size).toBe(0);
      expect(metodos().reviews[0].helpful).not.toBe(99);
    },
  );

  it("troca de produto durante releitura não altera a lista nem o cache atual", async () => {
    await montar();
    const leitura = pendente<{ data: { helpful: number }; error: null }>();
    h.reler.mockReturnValueOnce(leitura.promessa);
    await act(async () => {
      botao().click();
    });
    await montar({ produto: "outro-produto-inventado" });
    const cacheAtual = getReviewsCache("outro-produto-inventado");
    await act(async () => {
      leitura.resolver({ data: { helpful: 99 }, error: null });
    });
    expect(metodos().reviews[0].productId).toBe("outro-produto-inventado");
    expect(metodos().reviews[0].helpful).not.toBe(99);
    expect(getReviewsCache("outro-produto-inventado")).toEqual(cacheAtual);
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(2);
  });

  it("limpeza da geração durante releitura não repõe cache nem muda o estado", async () => {
    await montar();
    const leitura = pendente<{ data: { helpful: number }; error: null }>();
    h.reler.mockReturnValueOnce(leitura.promessa);
    await act(async () => {
      botao().click();
    });
    esquecerAvaliacoesGuardadas();
    await act(async () => {
      leitura.resolver({ data: { helpful: 99 }, error: null });
    });
    expect(getReviewsCache(PRODUTO)).toBeNull();
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(metodos().reviews[0].helpful).toBe(2);
  });

  it("leitura atrasada de votos da conta anterior não marca a conta nova", async () => {
    const votos = pendente<{ data: { review_id: string }[]; error: null }>();
    h.lerVotos.mockReturnValueOnce(votos.promessa);
    await montar();
    h.usuario = { id: "pessoa-b" };
    esquecerAvaliacoesGuardadas();
    await montar();
    await act(async () => {
      votos.resolver({ data: [{ review_id: AVALIACAO }], error: null });
    });
    expect(botao().disabled).toBe(false);
    expect(metodos().votosUteis.size).toBe(0);
  });

  it("deslogado não consulta votos nem herda a marcação da conta que saiu", async () => {
    h.votos.add(`pessoa-a:${AVALIACAO}`);
    await montar();
    expect(botao().disabled).toBe(true);
    h.usuario = null;
    esquecerAvaliacoesGuardadas();
    h.lerVotos.mockClear();
    await montar();
    expect(h.lerVotos).not.toHaveBeenCalled();
    expect(botao().disabled).toBe(false);
    await act(async () => {
      botao().click();
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Faça login para marcar como útil.",
    );
  });
});
