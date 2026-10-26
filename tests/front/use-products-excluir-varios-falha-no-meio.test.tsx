// @vitest-environment jsdom
//
// Excluir vários produtos de uma vez e a rede cair no meio: os que o banco já
// tinha excluído NÃO podem reaparecer na lista (tocar neles dava "Produto não
// encontrado"). Só volta para a lista o que de fato falhou ou ainda não foi
// processado. Mesmo molde de use-products-delete-fases.test.tsx.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  atualizados: [] as string[],
  resultados: [] as Array<{ error: any }>,
  linhas: [] as any[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: mock.fetchProductsContext,
  }),
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => ({
    id: row.id,
    name: row.nome,
    description: "",
    price: 10,
    stock: 1,
    category: "Geral",
    images: [],
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    sold: 0,
    variants: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: () =>
        Promise.resolve({
          data: { data: mock.linhas, total_count: mock.linhas.length },
          error: null,
        }),
    }),
    from: () => ({
      update: () => ({
        eq: async (_col: string, id: string) => {
          mock.atualizados.push(id);
          return mock.resultados.shift() ?? { error: null };
        },
      }),
    }),
    storage: { from: () => ({ copy: vi.fn(), getPublicUrl: vi.fn() }) },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useProducts>;
let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  const produtos = useProducts({ autoFetch: false });
  useEffect(() => {
    api = produtos;
  });
  return null;
}
const linha = (id: string) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: 10,
  estoque: 1,
  imagem_urls: [],
  ativo: true,
  product_variants: [],
});

beforeEach(async () => {
  vi.clearAllMocks();
  mock.fetchProductsContext.mockResolvedValue(undefined);
  mock.atualizados.length = 0;
  mock.resultados.length = 0;
  mock.linhas = [linha("p1"), linha("p2"), linha("p3"), linha("p4")];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
  await act(async () => {
    await api.loadProducts(0, 10);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const idsNaLista = () => api.products.map((p) => p.id);

it("a 3ª exclusão falha: p1 e p2 (já excluídos no banco) continuam FORA da lista; p3 e p4 voltam", async () => {
  expect(idsNaLista()).toEqual(["p1", "p2", "p3", "p4"]);
  mock.resultados = [
    { error: null },
    { error: null },
    { error: { message: "rede" } },
  ];

  let resultado: boolean | undefined;
  await act(async () => {
    resultado = await api.deleteProducts(["p1", "p2", "p3", "p4"]);
  });

  expect(resultado).toBe(false);
  expect(mock.atualizados).toEqual(["p1", "p2", "p3"]);
  expect(idsNaLista()).toEqual(["p3", "p4"]);
  expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produtos");
});

it("controle: a falha já na 1ª exclusão devolve o lote inteiro (nada foi excluído)", async () => {
  mock.resultados = [{ error: { message: "rede" } }];

  await act(async () => {
    await api.deleteProducts(["p1", "p2"]);
  });

  expect(idsNaLista()).toEqual(["p1", "p2", "p3", "p4"]);
});
