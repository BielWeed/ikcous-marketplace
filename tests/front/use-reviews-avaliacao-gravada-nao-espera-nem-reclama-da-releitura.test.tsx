// @vitest-environment jsdom
//
// Depois que a avaliação JÁ foi gravada, a releitura da lista não pode mais
// segurar a cliente nem assustá-la.
//
// O DEFEITO: addReview mostrava "Recebemos sua avaliação!" e só devolvia o
// resultado depois de `await getReviewsByProduct(...)`. (1) Se a releitura
// demorava, a folha de avaliar ficava presa e dava para fechar e reabrir e
// avaliar o mesmo produto de novo; (2) se a releitura falhava e não havia lista
// guardada no aparelho, aparecia o aviso vermelho "Erro ao carregar
// avaliações." logo depois do aviso de sucesso, mesmo com a avaliação gravada.
//
// Molde de montagem: use-reviews-erro-do-banco-nao-vaza-na-tela.test.tsx.
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

// `releitura` é o que o `.order()` da releitura devolve; `pendente` faz a
// releitura ficar pendurada até o teste soltá-la.
const h = vi.hoisted(() => ({
  releitura: { data: [] as unknown, error: null as unknown },
  soltarReleitura: null as null | (() => void),
  pendurarReleitura: false,
  releituras: 0,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: "rev-nova", product_id: "prod-sem-cache" },
              error: null,
            }),
        }),
      }),
      select: (colunas?: string) =>
        colunas === "id"
          ? {
              eq: () => ({
                eq: () => ({ limit: async () => ({ data: [], error: null }) }),
              }),
            }
          : {
              eq: () => ({
                order: () => {
                  h.releituras += 1;
                  if (h.pendurarReleitura) {
                    return new Promise((resolve) => {
                      h.soltarReleitura = () => resolve(h.releitura);
                    });
                  }
                  return Promise.resolve(h.releitura);
                },
              }),
            },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "comprador-teste" }, isAdmin: false }),
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

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AddReview = (avaliacao: {
  productId: string;
  rating: number;
  comment: string;
}) => Promise<unknown>;

describe("addReview — a releitura depois de gravar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    h.releitura = { data: [], error: null };
    h.soltarReleitura = null;
    h.pendurarReleitura = false;
    h.releituras = 0;
    const { toast } = await import("sonner");
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function pegarAddReview(): Promise<AddReview> {
    const capturada = vi.fn((_metodo: AddReview) => {});
    function Sonda() {
      const { addReview } = useReviews();
      useEffect(() => {
        capturada(addReview as AddReview);
      }, [addReview]);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    const metodo = capturada.mock.calls.at(-1)?.[0];
    if (!metodo) throw new Error("A sonda não capturou addReview");
    return metodo;
  }

  const avaliacao = {
    productId: "prod-sem-cache",
    rating: 5,
    comment: "Produto ótimo",
  };

  it("releitura que falha, sem lista guardada: só o aviso de sucesso, nunca o de erro", async () => {
    h.releitura = { data: null, error: { message: "falha de rede" } };
    const addReview = await pegarAddReview();

    let retorno: unknown;
    await act(async () => {
      retorno = await addReview(avaliacao);
      // deixa a releitura em segundo plano terminar de falhar
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    const { toast } = await import("sonner");
    expect(retorno).toEqual({ id: "rev-nova", product_id: "prod-sem-cache" });
    expect(h.releituras).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("releitura lenta: addReview devolve a avaliação sem esperar por ela", async () => {
    h.pendurarReleitura = true;
    const addReview = await pegarAddReview();

    let retorno: unknown = "ainda-nao-voltou";
    await act(async () => {
      // Corrida: a gravação confirmada tem de voltar mesmo com a releitura
      // pendurada. Se addReview esperar a releitura, vence o "travado".
      retorno = await Promise.race([
        addReview(avaliacao),
        new Promise((resolve) => setTimeout(() => resolve("travado"), 50)),
      ]);
    });

    expect(retorno).toEqual({ id: "rev-nova", product_id: "prod-sem-cache" });
    // a releitura foi pedida (aquece a lista), só não é esperada
    expect(h.releituras).toBe(1);
    await act(async () => {
      h.soltarReleitura?.();
    });
  });
});
