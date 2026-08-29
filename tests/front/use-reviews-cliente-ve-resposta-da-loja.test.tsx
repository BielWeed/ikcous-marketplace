// @vitest-environment jsdom
//
// A resposta da lojista tem de chegar à tela de quem comprou.
//
// O DEFEITO: `getReviewsByProduct` busca as avaliações com `select('*')`, então
// a coluna `merchant_reply` VEM do banco — mas o mapeador que monta o objeto
// para a página do produto montava só id/productId/userId/customerName/
// customerAvatar/rating/comment/verified/helpful/createdAt e descartava a
// resposta em silêncio. Os dois mapeadores do painel do admin (getAllReviews,
// nos dois caminhos) já copiavam `merchantReply: item.merchant_reply` — ou
// seja: a lojista respondia, via a própria resposta no painel, e o cliente
// nunca via nada. O ReviewCard já tem o bloco que desenha a resposta
// (src/components/ui/custom/ReviewCard.tsx, `{review.merchantReply && ...}`);
// ele só nunca tinha o que desenhar.
//
// POR QUE O TESTE PASSA PELO HOOK DE VERDADE (render React + jsdom) e não por
// função extraída isolada: quem perdia o campo era o fechamento dentro de
// useReviews().getReviewsByProduct, então é ELE que é exercitado aqui, com o
// cliente do Supabase dublê logo abaixo — mesmo precedente de
// use-reviews-erro-do-banco-nao-vaza-na-tela.test.tsx. Com a linha
// `merchantReply: item.merchant_reply` removida de volta, este teste CAI.
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo (`new BroadcastChannel(...)`) na importação.
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

// `lista` é o que a consulta de avaliações do produto devolve — as LINHAS CRUAS
// do banco, com nome de coluna do Postgres (`merchant_reply`), que é
// exatamente o formato que o mapeador recebe na vida real.
const h = vi.hoisted(() => ({
  lista: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // getReviewsByProduct: .from("reviews").select(...).eq(...).order(...)
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve(h.lista),
        }),
      }),
    }),
  },
}));

// Montar o hook precisa de sessão e eleição de aba; dublês mínimos, mesmo
// padrão do teste de mensagem de erro citado acima. `isAdmin: false` é o que
// importa: quem está olhando é o CLIENTE, não a lojista.
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
import type { Review } from "@/types";

// Mesmo padrão de product-card-gate-avaliacoes.test.tsx: sem esta flag o
// React reclama de act() em todo render.
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O texto da resposta é escolhido para NÃO poder passar por acidente: é uma
// frase longa e específica, não aparece em nenhum outro campo da linha, e não
// é string vazia nem valor que o mapeador produziria por outro caminho. Se o
// campo não for copiado do banco, não há de onde este texto sair.
const RESPOSTA_DA_LOJA =
  "Oi Marina! Trocamos o fornecedor do fecho em marco; me chama no chat que a gente envia a peca nova sem custo.";
const COMENTARIO_DO_CLIENTE =
  "Bolsa linda e bem acabada, mas o fecho comecou a soltar na segunda semana.";

/** O Node 25 expõe um `globalThis.localStorage` experimental SEM `.clear` nem
 * `.key`, e ele pisa na implementação do jsdom antes do teste rodar — o erro é
 * `localStorage.clear is not a function` mesmo com `@vitest-environment jsdom`.
 * O resto da suíte contorna com `vi.stubGlobal`; `auth-admin-check.test.tsx`
 * documenta a mesma armadilha. */
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

describe("getReviewsByProduct — o cliente vê a resposta da lojista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.lista = { data: [], error: null };
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

  /**
   * Monta uma sonda para alcançar `getReviewsByProduct` e o estado `reviews`
   * com os hooks do React vivos, busca as avaliações do produto e devolve a
   * lista exatamente como a tela do cliente a recebe.
   *
   * A captura vai num efeito, não no corpo do render: escrever em variável de
   * fora durante o render é efeito colateral.
   */
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

  it("a lojista respondeu: o texto da resposta chega ao objeto que a tela do cliente renderiza", async () => {
    h.lista = {
      data: [
        {
          id: "rev-1",
          product_id: "prod-bolsa",
          user_id: "cliente-1",
          rating: 3,
          comment: COMENTARIO_DO_CLIENTE,
          verified: true,
          helpful: 2,
          created_at: "2026-08-20T12:00:00.000Z",
          merchant_reply: RESPOSTA_DA_LOJA,
          user: { full_name: "Marina", avatar_url: null },
        },
      ],
      error: null,
    };

    const avaliacoes = await buscarAvaliacoesDoProduto("prod-bolsa");

    expect(avaliacoes).toHaveLength(1);

    // O QUE A PESSOA VÊ: o ReviewCard só desenha o bloco da resposta quando
    // `review.merchantReply` tem conteúdo. É este campo, com este texto, que
    // decide se a resposta aparece ou some.
    expect(avaliacoes[0]?.merchantReply).toBe(RESPOSTA_DA_LOJA);

    // A resposta não pode ter vindo emprestada de outro campo: ela é o texto
    // da LOJA, não o comentário de quem comprou.
    expect(avaliacoes[0]?.merchantReply).not.toBe(avaliacoes[0]?.comment);
    expect(avaliacoes[0]?.comment).toBe(COMENTARIO_DO_CLIENTE);

    // O resto do mapeamento continua igual ao de antes: a correção é cirúrgica,
    // nenhum outro campo mudou de valor nem sumiu.
    expect(avaliacoes[0]).toMatchObject({
      id: "rev-1",
      productId: "prod-bolsa",
      userId: "cliente-1",
      customerName: "Marina",
      customerAvatar: undefined,
      rating: 3,
      verified: true,
      helpful: 2,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("na segunda visita a resposta continua lá: o cache que a tela lê primeiro também guarda o texto", async () => {
    // A tela mostra o cache ANTES da rede responder (SWR). Se a resposta não
    // for gravada ali, ela sumiria a cada recarga até a consulta voltar.
    h.lista = {
      data: [
        {
          id: "rev-1",
          product_id: "prod-bolsa",
          user_id: "cliente-1",
          rating: 3,
          comment: COMENTARIO_DO_CLIENTE,
          verified: true,
          helpful: 2,
          created_at: "2026-08-20T12:00:00.000Z",
          merchant_reply: RESPOSTA_DA_LOJA,
          user: { full_name: "Marina", avatar_url: null },
        },
      ],
      error: null,
    };

    await buscarAvaliacoesDoProduto("prod-bolsa-cache");

    const gravado = localStorage.getItem(
      "ikcous_reviews_cache_prod-bolsa-cache",
    );
    expect(gravado).not.toBeNull();
    expect(JSON.parse(String(gravado))[0]?.merchantReply).toBe(
      RESPOSTA_DA_LOJA,
    );
  });

  it("sem resposta da loja: o campo fica vazio e o bloco de resposta não aparece", async () => {
    // Controle negativo: quando o banco devolve `merchant_reply: null`, o campo
    // tem de continuar sem conteúdo — senão o ReviewCard desenharia uma caixa
    // de "Resposta da loja" vazia embaixo de toda avaliação não respondida.
    h.lista = {
      data: [
        {
          id: "rev-2",
          product_id: "prod-caneca",
          user_id: "cliente-2",
          rating: 5,
          comment: "Chegou antes do prazo, recomendo.",
          verified: false,
          helpful: 0,
          created_at: "2026-08-21T09:30:00.000Z",
          merchant_reply: null,
          user: { full_name: "Rafa", avatar_url: null },
        },
      ],
      error: null,
    };

    const avaliacoes = await buscarAvaliacoesDoProduto("prod-caneca");

    expect(avaliacoes).toHaveLength(1);
    expect(avaliacoes[0]?.merchantReply).toBeFalsy();
  });
});
