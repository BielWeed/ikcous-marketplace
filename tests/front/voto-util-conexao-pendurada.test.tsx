// @vitest-environment jsdom
// Rede "pendurada" conecta e não responde. O botão Útil ficava desabilitado
// até o `finally` do card, que esperava uma RPC (e depois a releitura) sem
// prazo: a pessoa via o botão travado para sempre, sem aviso. O hook e o card
// são reais; só a rede é dublada, e o relógio é falso.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  usuario: { id: "pessoa-a" } as { id: string } | null,
  contador: 2,
  rpc: vi.fn(),
  reler: vi.fn(),
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
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: async () => ({ data: [], error: null }),
        order: async () => ({
          data: [
            {
              id: "avaliacao-inventada",
              product_id: "produto-inventado",
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
const PRAZO_MS = 15_000;
const AVISO = "Não deu para confirmar seu voto. Tente de novo.";

let metodosAtuais: ReturnType<typeof useReviews>;

function Sonda() {
  const metodos = useReviews();
  const { getReviewsByProduct } = metodos;
  useEffect(() => {
    metodosAtuais = metodos;
  }, [metodos]);
  useEffect(() => {
    void getReviewsByProduct(PRODUTO);
  }, [getReviewsByProduct]);
  return metodos.reviews.map((review) => (
    <ReviewCard
      key={review.id}
      review={review}
      jaVotou={metodos.votosUteis.has(review.id)}
      onHelpful={metodos.markHelpful}
    />
  ));
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
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("voto útil com a conexão pendurada", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    h.usuario = { id: "pessoa-a" };
    h.contador = 2;
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    esquecerAvaliacoesGuardadas();
    h.reler.mockImplementation(async () => ({
      data: { helpful: h.contador },
      error: null,
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => raiz.unmount());
    host.remove();
    esquecerAvaliacoesGuardadas();
    vi.unstubAllGlobals();
  });

  const botao = () => host.querySelector("button") as HTMLButtonElement;

  it("RPC que nunca responde: solta o botão, avisa e não mexe no contador", async () => {
    h.rpc.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      botao().click();
    });
    expect(botao().disabled).toBe(true); // em voo, dentro do prazo
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_MS);
    });

    expect(botao().disabled).toBe(false);
    expect(botao().textContent).toContain("Útil (2)");
    expect(toast.error).toHaveBeenCalledWith(AVISO);
    expect(getReviewsCache(PRODUTO)?.[0].helpful).toBe(2);
    expect(h.reler).not.toHaveBeenCalled();
  });

  it("depois do aviso dá para tentar de novo e o voto conta", async () => {
    h.rpc.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      botao().click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_MS);
    });
    h.rpc.mockImplementationOnce(async () => {
      h.contador = 3;
      return { error: null };
    });
    await act(async () => {
      botao().click();
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(botao().disabled).toBe(true);
    expect(botao().textContent).toContain("Útil (3)");
  });

  it("releitura que nunca responde depois da RPC ok: voto vale, sem aviso de erro", async () => {
    h.rpc.mockImplementationOnce(async () => {
      h.contador = 3;
      return { error: null };
    });
    h.reler.mockReturnValueOnce(new Promise(() => {}));
    let desfecho: boolean | undefined;
    await act(async () => {
      void metodosAtuais.markHelpful("avaliacao-inventada").then((valeu) => {
        desfecho = valeu;
      });
    });
    expect(desfecho).toBeUndefined(); // ainda esperando a releitura

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_MS);
    });

    expect(desfecho).toBe(true); // a espera termina e o voto vale
    expect(botao().disabled).toBe(true); // voto registrado, não reabre
    expect(toast.error).not.toHaveBeenCalled();
    expect(botao().textContent).toContain("Útil (2)"); // último número confirmado
  });
});
