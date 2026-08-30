// @vitest-environment jsdom
//
// Item 3 do laudo "o que falta" (29/08, degrau 1): o formulário manda
// `costPrice: null` quando o campo custo fica vazio (ADMIN-050), mas o
// insert do `useProducts.addProduct` achatava com `|| 0` — e o produto
// cadastrado SEM custo entrava no banco com custo 0. Como a tela não tinha
// como distinguir os dois estados, o brinde de custo zero de propósito
// aparecia como "Sem Custo Cadastrado" (e vice-versa) — a origem ambígua
// está documentada no gatilho de AdminProductsView (achado 8).
//
// Com a migration 20261024000000 (produtos.custo DROP NOT NULL), o hook
// grava o que veio: null é ausência, 0 é zero medido. Estes testes olham o
// PAYLOAD que chega ao banco (dublê do supabase capturando o insert), não a
// tela — a tela é coberta por admin-products-margem-sem-custo.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insercoes: { tabela: string; payload: any }[] = [];

// O produto que "o banco" devolve do .single() do insert — o mínimo que o
// mapper precisa para virar Product sem reclamar.
const PRODUTO_DO_BANCO = {
  id: "prod-novo",
  nome: "Produto de Teste",
  preco_venda: 100,
  custo: null,
  estoque: 10,
  ativo: true,
  imagem_urls: ["https://proj.supabase.co/storage/v1/object/public/p/f.jpg"],
  tags: [],
  sold: 0,
};

type Resposta = { data: any; error: any; count?: number };
const RESPOSTA_VAZIA: Resposta = { data: [], error: null, count: 0 };
const RESPOSTA_SINGLE: Resposta = { data: PRODUTO_DO_BANCO, error: null };

/** Nó encadeável que responde QUALQUER método do supabase-js com ele mesmo
 * e termina thenable com `resposta` — `.insert(x).select().single()`,
 * `.rpc(...)`, `.update(...).eq(...)` todos resolvem. `insert` é o único
 * método com efeito: registra a tabela e o payload para as asserções. */
function criarCadeia(resposta: Resposta) {
  const no: any = new Proxy((() => {}) as unknown as object, {
    get(_alvo, prop: string | symbol) {
      if (prop === "then") {
        return (res: (v: Resposta) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(resposta).then(res, rej);
      }
      if (prop === "catch") {
        return (rej: (e: unknown) => unknown) =>
          Promise.resolve(resposta).catch(rej);
      }
      if (prop === "insert") {
        return (payload: any) => {
          insercoes.push({ tabela: tabelaAtual, payload });
          return no;
        };
      }
      return () => no;
    },
    apply() {
      return no;
    },
  });
  return no;
}

let tabelaAtual = "";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      tabelaAtual = tabela;
      return criarCadeia(
        tabela === "vw_produtos_admin" ? RESPOSTA_SINGLE : RESPOSTA_VAZIA,
      );
    },
    rpc: () => criarCadeia(RESPOSTA_VAZIA),
    auth: {
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// admin-products-margem-sem-custo.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function payloadBase(costPrice: number | null | undefined) {
  return {
    name: "Produto de Teste",
    description: "Descrição",
    price: 100,
    costPrice,
    originalPrice: undefined,
    images: ["https://proj.supabase.co/storage/v1/object/public/p/f.jpg"],
    category: "Geral",
    stock: 10,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    variants: [],
  };
}

describe("useProducts.addProduct — custo null grava null, custo zero grava zero", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let gancho: { addProduct: (p: unknown) => Promise<unknown> };

  beforeEach(() => {
    vi.clearAllMocks();
    insercoes.length = 0;
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

  async function comHook(): Promise<void> {
    const { useProducts } = await import("@/hooks/useProducts");

    function Hospedeiro() {
      const hook = useProducts({ autoFetch: false });
      // Captura em efeito, não no render: a mesma regra da catraca
      // (react-hooks/globals) que o lote 1 da manhã pegou no hospedeiro.
      useEffect(() => {
        gancho = hook as unknown as {
          addProduct: (p: unknown) => Promise<unknown>;
        };
      }, [hook]);
      return null;
    }

    await act(async () => {
      raiz.render(<Hospedeiro />);
    });
  }

  async function cadastrar(costPrice: number | null | undefined) {
    await act(async () => {
      await gancho.addProduct(payloadBase(costPrice));
    });
  }

  function insercaoDoProduto(): { tabela: string; payload: any } {
    const insert = insercoes.find((i) => i.tabela === "vw_produtos_admin");
    expect(insert).toBeDefined();
    return insert!;
  }

  it("custo AUSENTE (null do formulário): o insert leva custo null ao banco", async () => {
    await comHook();
    await cadastrar(null);

    expect(insercaoDoProduto().payload.custo).toBeNull();
  });

  it("custo ZERO medido: o insert leva 0 ao banco — o brinde não vira ausência", async () => {
    await comHook();
    await cadastrar(0);

    expect(insercaoDoProduto().payload.custo).toBe(0);
  });

  it("custo UNDEFINED (chave sem valor): defesa do hook, grava null e não 0", async () => {
    await comHook();
    await cadastrar(undefined);

    expect(insercaoDoProduto().payload.custo).toBeNull();
  });
});
