// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as any,
  variacoes: [] as any[],
  skus: [] as any[],
  rpc: vi.fn(),
  refresh: vi.fn(),
  analytics: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [banco.produto],
    loadingProducts: false,
    fetchProducts: banco.refresh,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: banco.analytics,
}));
vi.mock("sonner", () => ({
  toast: { success: banco.sucesso, error: banco.erro },
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (linha: any) => ({
    ...linha,
    variants: linha.product_variants,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: banco.rpc,
    from: (tabela: string) => {
      // Só leitura aqui: qualquer PATCH/INSERT/UPSERT fora da RPC falha.
      const consulta = {
        eq: () =>
          tabela === "product_variants"
            ? Object.assign(
                Promise.resolve({ data: banco.variacoes, error: null }),
                { in: consulta.in },
              )
            : consulta,
        is: () => consulta,
        single: async () => ({ data: banco.produto, error: null }),
        in: async (coluna: string, valores: string[]) => ({
          data:
            coluna === "sku"
              ? banco.skus.filter((v) => valores.includes(v.sku))
              : banco.variacoes.filter((v) => valores.includes(v.id)),
          error: null,
        }),
      };
      if (!["vw_produtos_admin", "product_variants"].includes(tabela)) {
        throw new Error(`Tabela inesperada: ${tabela}`);
      }
      return { select: () => consulta };
    },
    storage: {
      from: () => ({
        copy: banco.copy,
        getPublicUrl: () => ({ data: { publicUrl: "backup" } }),
      }),
    },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useProducts>;
let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  const produtos = useProducts();
  useEffect(() => {
    api = produtos;
  });
  return null;
}
const BASE = "2026-10-21T13:00:00.123456+00:00";
const NOVA = "2026-10-21T13:00:01.654321+00:00";
const variante = (patch = {}) => ({
  id: "v-1",
  name: "Cor",
  value: "Rosa",
  active: true,
  ...patch,
});
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  banco.produto = {
    id: "p-1",
    name: "Camiseta",
    price: 50,
    costPrice: 20,
    stock: 10,
    images: [],
    updatedAt: BASE,
  };
  banco.variacoes = [];
  banco.skus = [];
  banco.refresh.mockResolvedValue(undefined);
  banco.copy.mockResolvedValue({ error: null });
  banco.rpc.mockImplementation(async () => {
    banco.produto = { ...banco.produto, updatedAt: NOVA };
    return {
      data: { ultima_atualizacao: NOVA, apagadas: [], recusadas: [] },
      error: null,
    };
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("grava uma única RPC com patch, base exata, grade mista e exclusões; limpa cache uma vez", async () => {
  await act(async () => {
    const retorno = await api.salvarProdutoComGrade(
      "p-1",
      { price: 60, stock: 8, estoqueMinimo: null, sku: "", images: [] },
      {
        baseUpdatedAt: BASE,
        variantes: [
          variante({ stockIncrement: 8 }),
          variante({ id: "temp-nova", value: "Azul", stockIncrement: 0 }),
        ],
        apagar: ["v-apagar"],
      },
    );
    expect(retorno?.produto?.updatedAt).toBe(NOVA);
    expect(retorno?.recusadas).toEqual([]);
  });
  expect(banco.rpc).toHaveBeenCalledExactlyOnceWith(
    "salvar_produto_com_grade",
    {
      p_produto_id: "p-1",
      p_base_atualizado_em: BASE,
      p_produto: {
        preco_venda: 60,
        estoque: 8,
        estoque_minimo: null,
        codigo: null,
        imagem_urls: [],
        imagem_url: null,
      },
      p_variantes: [
        {
          id: "v-1",
          name: "Cor",
          value: "Rosa",
          sku: null,
          codigo_barras: null,
          price_override: null,
          active: true,
          image_url: null,
          stock_increment: 8,
        },
        {
          name: "Cor",
          value: "Azul",
          sku: null,
          codigo_barras: null,
          price_override: null,
          active: true,
          image_url: null,
          stock_increment: 0,
        },
      ],
      p_apagar: ["v-apagar"],
    },
  );
  expect(banco.refresh).toHaveBeenCalledTimes(1);
  expect(banco.analytics).toHaveBeenCalledTimes(1);
  expect(banco.sucesso).toHaveBeenCalledTimes(1);
});

it("sem estoque mexido manda base nula e omite stock_increment, sem preencher com null", async () => {
  await act(async () => {
    await api.salvarProdutoComGrade(
      "p-1",
      { price: 60 },
      {
        variantes: [variante()],
        apagar: [],
      },
    );
  });
  const parametros = banco.rpc.mock.calls[0][1];
  expect(parametros.p_base_atualizado_em).toBeNull();
  expect(parametros.p_produto).not.toHaveProperty("estoque");
  expect(parametros.p_variantes[0]).not.toHaveProperty("stock_increment");
});

it("PRD01 vira recusa de versão com produtoAtual e não prossegue com efeitos de sucesso", async () => {
  banco.rpc.mockResolvedValue({ data: null, error: { code: "PRD01" } });
  let erro: any;
  await act(async () => {
    try {
      await api.salvarProdutoComGrade(
        "p-1",
        { stock: 8 },
        {
          baseUpdatedAt: BASE,
          variantes: [variante({ stockIncrement: 8 })],
          apagar: [],
        },
      );
    } catch (e) {
      erro = e;
    }
  });
  expect(erro?.name).toBe("RecusaDoCadastroDeProduto");
  expect(erro?.message).toMatch(/o produto mudou.*recarregue/i);
  expect(erro?.produtoAtual).toMatchObject({ id: "p-1", stock: 10 });
  expect(banco.rpc).toHaveBeenCalledTimes(1);
  expect(banco.refresh).not.toHaveBeenCalled();
  expect(banco.analytics).not.toHaveBeenCalled();
  expect(banco.sucesso).not.toHaveBeenCalled();
  expect(banco.erro).toHaveBeenCalledTimes(1);
});

it("SKU da variação que sai pode ser reutilizado no mesmo salvar", async () => {
  banco.skus = [{ id: "v-apagar", product_id: "p-1", sku: "ROSA" }];
  await act(async () => {
    await api.salvarProdutoComGrade(
      "p-1",
      {},
      {
        variantes: [variante({ sku: "ROSA" })],
        apagar: ["v-apagar"],
      },
    );
  });
  expect(banco.rpc).toHaveBeenCalledTimes(1);
});

it("id de outro produto em apagar não libera o SKU alheio", async () => {
  banco.skus = [{ id: "v-alheia", product_id: "p-2", sku: "ROSA" }];
  await act(async () => {
    await expect(
      api.salvarProdutoComGrade(
        "p-1",
        {},
        {
          variantes: [variante({ sku: "ROSA" })],
          apagar: ["v-alheia"],
        },
      ),
    ).rejects.toThrow(/SKU/);
  });
  expect(banco.rpc).not.toHaveBeenCalled();
});

it("TruthGate da grade inteira recusa antes da RPC, usando custo do produto atualizado", async () => {
  await act(async () => {
    await expect(
      api.salvarProdutoComGrade(
        "p-1",
        {},
        {
          variantes: [variante({ stockIncrement: -1 })],
          apagar: [],
        },
      ),
    ).rejects.toThrow(/Validação de Variante/);
  });
  expect(banco.rpc).not.toHaveBeenCalled();
});

it("recusadas são devolvidas e só as imagens efetivamente apagadas recebem backup", async () => {
  const url = (nome: string) =>
    `https://loja.invalid/storage/v1/object/public/products/${nome}.jpg`;
  banco.produto.images = [url("capa")];
  banco.variacoes = [
    { id: "v-apagada", image_url: url("apagada") },
    { id: "v-vendida", image_url: url("vendida") },
  ];
  banco.rpc.mockResolvedValue({
    data: {
      ultima_atualizacao: NOVA,
      apagadas: ["v-apagada"],
      recusadas: ["v-vendida"],
    },
    error: null,
  });
  await act(async () => {
    const retorno = await api.salvarProdutoComGrade(
      "p-1",
      { images: [] },
      {
        variantes: [],
        apagar: ["v-apagada", "v-vendida"],
      },
    );
    expect(retorno?.recusadas).toEqual(["v-vendida"]);
  });
  expect(banco.copy.mock.calls.map(([origem]) => origem).sort()).toEqual([
    "apagada.jpg",
    "capa.jpg",
  ]);
  expect(banco.refresh).toHaveBeenCalledTimes(1);
  // O formulário dá o aviso de recusa, sem sucesso por baixo.
  expect(banco.sucesso).not.toHaveBeenCalled();
});
