// @vitest-environment jsdom
//
// I-3 (brief hub-0809-g 08/09/2026:
// equipe/entregas/20260908-brief-i3-i4-anon-nao-le-autor-nem-grava-analytics.md).
//
// O DEFEITO: `getReviewsByProduct` (chamada incondicionalmente pela página
// do produto, `ProductView.tsx`, para QUALQUER visitante) consultava
// `.from("reviews").select("*, user:public_profiles(...)")` direto na
// tabela — a coluna `user_id` viajava no payload de todo visitante sem
// login, mesmo sem a tela desenhar o campo (a API vaza o que a tela não
// mostra). Com as migrations 20261111000000/20261112000000 aplicadas, essa
// consulta nem retornaria linha para `anon` (RLS passa a exigir
// `authenticated`) — então o visitante DEIXARIA de ver avaliações também.
//
// O CONSERTO: quando não há sessão (`user` nulo em `useAuth`),
// `getReviewsByProduct` passa a consultar `vw_reviews_public`
// (20261110000000) em vez de `reviews` — a view nunca teve a coluna
// `user_id` para vazar. Quem está logado continua na tabela, sem mudança
// (o hook já sabe distinguir os dois — mesmo padrão de
// `use-reviews-cliente-ve-resposta-da-loja.test.tsx`).
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo na importação.
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

// `chamadasFrom` grava, na ORDEM em que aconteceram, o nome de cada tabela/
// view que o hook pediu ao Supabase — é o espião que prova QUAL relação foi
// consultada, não só o que ela devolveu.
const h = vi.hoisted(() => ({
  chamadasFrom: [] as string[],
  linhaAnon: [] as unknown[],
  linhaLogado: [] as unknown[],
  usuarioLogado: null as { id: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      h.chamadasFrom.push(tabela);
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () =>
        Promise.resolve({
          data: tabela === "vw_reviews_public" ? h.linhaAnon : h.linhaLogado,
          error: null,
        });
      return builder;
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuarioLogado, isAdmin: false }),
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
import type { Review } from "@/types";

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
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("getReviewsByProduct — o visitante anônimo lê a vitrine pública, sem o autor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.chamadasFrom = [];
    h.linhaAnon = [];
    h.linhaLogado = [];
    h.usuarioLogado = null;
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    localStorage.clear();
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

  type GetReviewsByProduct = (productId: string) => Promise<void>;

  const buscarAvaliacoesDoProduto = async (
    productId: string,
  ): Promise<Review[]> => {
    type SondaProps = {
      readonly aoCapturar: (m: GetReviewsByProduct) => void;
      readonly aoRenderizar: (lista: Review[]) => void;
    };
    const capturada = vi.fn((_metodo: GetReviewsByProduct) => {});
    const renderizada = vi.fn((_lista: Review[]) => {});

    function Sonda({ aoCapturar, aoRenderizar }: SondaProps) {
      const { getReviewsByProduct, reviews } = useReviews();
      useEffect(() => {
        aoCapturar(getReviewsByProduct as GetReviewsByProduct);
      }, [getReviewsByProduct, aoCapturar]);
      useEffect(() => {
        aoRenderizar(reviews);
      }, [reviews, aoRenderizar]);
      return null;
    }

    await act(async () => {
      raiz.render(<Sonda aoCapturar={capturada} aoRenderizar={renderizada} />);
    });
    const metodo = capturada.mock.calls.at(-1)?.[0];
    if (!metodo) throw new Error("A sonda não capturou getReviewsByProduct");

    await act(async () => {
      await metodo(productId);
    });

    const ultima = renderizada.mock.calls.at(-1)?.[0];
    if (!ultima) throw new Error("A sonda não recebeu a lista de avaliações");
    return ultima;
  };

  it("visitante SEM sessão: pede vw_reviews_public, nunca reviews, e o objeto não carrega userId", async () => {
    h.usuarioLogado = null;
    h.linhaAnon = [
      {
        id: "rev-1",
        product_id: "prod-bolsa",
        rating: 5,
        comment: "Produto ótimo",
        created_at: "2026-08-20T12:00:00.000Z",
        helpful: 1,
        verified: true,
        merchant_reply: null,
        merchant_reply_at: null,
        author_name: "Marina",
        author_avatar_url: null,
      },
    ];

    const avaliacoes = await buscarAvaliacoesDoProduto("prod-bolsa");

    // A relação pedida foi a VIEW pública — nunca a tabela crua.
    expect(h.chamadasFrom).toContain("vw_reviews_public");
    expect(h.chamadasFrom).not.toContain("reviews");

    expect(avaliacoes).toHaveLength(1);
    expect(avaliacoes[0]?.userId).toBeUndefined();
    expect(avaliacoes[0]).toMatchObject({
      id: "rev-1",
      productId: "prod-bolsa",
      customerName: "Marina",
      rating: 5,
      comment: "Produto ótimo",
      verified: true,
    });
  });

  it("visitante COM sessão: continua pedindo a tabela reviews, comportamento inalterado", async () => {
    h.usuarioLogado = { id: "cliente-1" };
    h.linhaLogado = [
      {
        id: "rev-2",
        product_id: "prod-caneca",
        user_id: "cliente-9",
        rating: 4,
        comment: "Gostei",
        created_at: "2026-08-21T09:30:00.000Z",
        helpful: 0,
        verified: false,
        status: "publicada",
        merchant_reply: null,
        user: { full_name: "Rafa", avatar_url: null },
      },
    ];

    const avaliacoes = await buscarAvaliacoesDoProduto("prod-caneca");

    expect(h.chamadasFrom).toContain("reviews");
    expect(h.chamadasFrom).not.toContain("vw_reviews_public");

    expect(avaliacoes).toHaveLength(1);
    expect(avaliacoes[0]?.userId).toBe("cliente-9");
    expect(avaliacoes[0]?.customerName).toBe("Rafa");
  });
});
