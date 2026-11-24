// @vitest-environment jsdom
//
// "Você também pode gostar": o buscador REAL (`fetchRecommendations`, dentro do
// `useProducts`) alimentado por um Supabase simulado que REGISTRA o que foi
// pedido à função `get_product_recommendations`. O teste vizinho
// (recomendacao-com-variacao-nao-entra-sem-tamanho) usa uma rpc que ignora os
// parâmetros e nunca olha a ordem, então por mutação sobreviviam:
//  - trocar o limite padrão da faixa (4 cards) por outro número;
//  - perguntar pelas recomendações de OUTRO produto (o id da página);
//  - inverter a ordem (o esgotado passava à frente do que se pode comprar);
//  - engolir o erro da função e devolver lista vazia (que a tela leria como
//    "sem recomendações" e apagaria a cópia boa guardada).
// O que a função escolhe (próprio produto de fora, pausados, teto) é SQL e tem
// prova própria em tests/banco; aqui vale o que o front pede e como organiza.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const mock = vi.hoisted(() => ({
  retorno: {
    data: [] as Record<string, unknown>[] | null,
    error: null as unknown,
  },
  chamadas: [] as { nome: string; args: Record<string, unknown> }[],
  consultasDeVariacao: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: Record<string, unknown>) => {
      mock.chamadas.push({ nome, args });
      return Promise.resolve(mock.retorno);
    },
    from: (tabela: string) => {
      if (tabela !== "product_variants") {
        throw new Error(`tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          in: () => {
            mock.consultasDeVariacao += 1;
            return Promise.resolve({ data: [], error: null });
          },
        }),
      };
    },
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = (
  id: string,
  estoque: number,
  nome = `Peça ${id}`,
): Record<string, unknown> => ({
  id,
  nome,
  descricao: "x",
  categoria: "Vestidos",
  codigo: `C-${id}`,
  custo: null,
  preco_venda: 100,
  estoque,
  estoque_minimo: 0,
  fornecedor_id: null,
  ativo: true,
  tags: [],
  data_cadastro: "2026-10-01T00:00:00Z",
  ultima_atualizacao: "2026-10-01T00:00:00Z",
  imagem_url: "https://example.com/v.png",
  meta_title: null,
  meta_description: null,
  imagem_urls: ["https://example.com/v.png"],
  preco_original: null,
  is_bestseller: false,
  frete_gratis: false,
  sold: 0,
  deleted_at: null,
  calculated_points: 0,
  rating: 0,
  review_count: 0,
  peso_kg: null,
  largura_cm: null,
  altura_cm: null,
  comprimento_cm: null,
  codigo_barras: null,
});

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  mock.retorno = { data: [], error: null };
  mock.chamadas = [];
  mock.consultasDeVariacao = 0;
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

type Buscar = (productId: string, limit?: number) => Promise<Product[]>;

/** O buscador REAL do `useProducts`, sem render de tela. */
async function buscador(): Promise<Buscar> {
  const { useProducts } = await import("@/hooks/useProducts");
  let api: ReturnType<typeof useProducts> | undefined;
  function Sonda() {
    const retorno = useProducts({ autoFetch: false });
    useEffect(() => {
      api = retorno;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  if (!api) throw new Error("A sonda não capturou o useProducts");
  return api.fetchRecommendations as Buscar;
}

describe("faixa 'Você também pode gostar': o que o front pede à função", () => {
  it("pergunta pelo produto DA PÁGINA e pede 4 por padrão", async () => {
    const buscar = await buscador();

    await act(async () => {
      await buscar("produto-da-pagina");
    });

    expect(mock.chamadas).toEqual([
      {
        nome: "get_product_recommendations",
        args: { p_product_id: "produto-da-pagina", p_limit: 4 },
      },
    ]);
  });

  it("limite explícito segue para a função como veio", async () => {
    const buscar = await buscador();

    await act(async () => {
      await buscar("p", 8);
    });

    expect(mock.chamadas[0]?.args).toEqual({ p_product_id: "p", p_limit: 8 });
  });
});

describe("faixa 'Você também pode gostar': ordem e vazio", () => {
  it("esgotados vão para o fim; entre iguais, a ordem que a função mandou fica", async () => {
    mock.retorno = {
      data: [
        linha("esgotado-1", 0),
        linha("disponivel-1", 3),
        linha("esgotado-2", 0),
        linha("disponivel-2", 1),
      ],
      error: null,
    };
    const buscar = await buscador();
    let recs: Product[] = [];

    await act(async () => {
      recs = await buscar("p");
    });

    expect(recs.map((r) => r.id)).toEqual([
      "disponivel-1",
      "disponivel-2",
      "esgotado-1",
      "esgotado-2",
    ]);
  });

  it("peça com 1 unidade em estoque conta como disponível (o limite é 'maior que zero')", async () => {
    mock.retorno = {
      data: [linha("zero", 0), linha("uma", 1)],
      error: null,
    };
    const buscar = await buscador();
    let recs: Product[] = [];

    await act(async () => {
      recs = await buscar("p");
    });

    expect(recs.map((r) => r.id)).toEqual(["uma", "zero"]);
  });

  it("função devolve nulo: lista vazia e nenhuma consulta de variações", async () => {
    mock.retorno = { data: null, error: null };
    const buscar = await buscador();
    let recs: Product[] | undefined;

    await act(async () => {
      recs = await buscar("p");
    });

    expect(recs).toEqual([]);
    expect(mock.consultasDeVariacao).toBe(0);
  });
});

describe("faixa 'Você também pode gostar': a função falhou", () => {
  it("o erro SOBE para quem chamou (falha não é 'sem recomendações')", async () => {
    mock.retorno = { data: null, error: { message: "boom" } };
    const buscar = await buscador();
    let motivo: unknown;

    await act(async () => {
      motivo = await buscar("p").then(
        () => undefined,
        (erro: unknown) => erro,
      );
    });

    expect(motivo).toEqual({ message: "boom" });
  });
});
