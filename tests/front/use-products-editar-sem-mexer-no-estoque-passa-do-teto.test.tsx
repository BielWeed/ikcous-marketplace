// @vitest-environment jsdom
//
// Produto cuja grade soma mais de 10.000 (3 variações de 4.000 = 12.000; cada
// uma passa no limite da variação). Antes, QUALQUER edição dele falhava com
// "o estoque não pode passar de 10.000": a conferência do teto olhava o
// estoque somado que JÁ está gravado, mesmo quando a edição nem mandava
// estoque. O teto vale para o estoque que o salvar MANDA; o já gravado não
// reprova uma edição que não mexe nele.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as any,
  rpc: vi.fn(),
  erro: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "u-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [banco.produto],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: banco.erro, info: banco.info },
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
    from: () => {
      const consulta: any = {
        eq: () => consulta,
        is: () => consulta,
        single: async () => ({ data: banco.produto, error: null }),
        in: async () => ({ data: [], error: null }),
      };
      return { select: () => consulta };
    },
    storage: { from: () => ({ copy: vi.fn(), getPublicUrl: vi.fn() }) },
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

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  banco.produto = {
    id: "p-1",
    name: "Camiseta",
    price: 50,
    stock: 12000,
    images: [],
    updatedAt: BASE,
  };
  banco.rpc.mockResolvedValue({
    data: { ultima_atualizacao: NOVA, apagadas: [], recusadas: [] },
    error: null,
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
});

it("salvarProdutoComGrade: editar só o nome de um produto com 12.000 gravados NÃO é recusado", async () => {
  await act(async () => {
    await api.salvarProdutoComGrade(
      "p-1",
      { name: "x" },
      { variantes: [], apagar: [] },
    );
  });
  expect(banco.rpc).toHaveBeenCalledTimes(1);
  expect(banco.erro).not.toHaveBeenCalled();
});

it("controle: MANDAR estoque acima de 10.000 continua recusado, antes da RPC", async () => {
  await act(async () => {
    await expect(
      api.salvarProdutoComGrade(
        "p-1",
        { stock: 12001 },
        { baseUpdatedAt: BASE, variantes: [], apagar: [] },
      ),
    ).rejects.toThrow(/stock_limit_exceeded/);
  });
  expect(banco.rpc).not.toHaveBeenCalled();
});

it("updateProduct offline: editar só o nome não é recusado pelo estoque já gravado", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    await api.updateProduct("p-1", { name: "x" });
  });
  expect(banco.erro).not.toHaveBeenCalled();
  expect(banco.info).toHaveBeenCalledWith(
    "Alteração guardada offline.",
    expect.anything(),
  );
});

it("controle: updateProduct offline mandando estoque acima de 10.000 continua recusado", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    await expect(api.updateProduct("p-1", { stock: 12001 })).rejects.toThrow(
      /stock_limit_exceeded/,
    );
  });
});
