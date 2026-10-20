// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { data: unknown; error: unknown };
const mock = vi.hoisted(() => ({
  produto: { data: null, error: null } as Resultado,
  variantes: { data: [], error: null } as Resultado,
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: mock.refresh,
    config: { shippingCoverage: "national" },
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const resultado =
        tabela === "product_variants" ? mock.variantes : mock.produto;
      const consulta = Promise.resolve(resultado) as Promise<Resultado> & {
        select: () => typeof consulta;
        eq: () => typeof consulta;
        is: () => typeof consulta;
        single: () => Promise<Resultado>;
      };
      consulta.select = () => consulta;
      consulta.eq = () => consulta;
      consulta.is = () => consulta;
      consulta.single = () => Promise.resolve(resultado);
      return consulta;
    },
    auth: { refreshSession: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: mock.toastError,
    info: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;
function Sonda({ onReady }: { onReady: (api: Api) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => onReady(api));
  return null;
}
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      id="product-category"
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

describe("Produto — falha ao carregar variações", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.produto = {
      data: {
        id: "prod-1",
        nome: "Camiseta",
        descricao: "Camiseta de algodão",
        preco_venda: 50,
        estoque: 20,
        categoria: "Geral",
        imagem_urls: [],
        ativo: true,
      },
      error: null,
    };
    mock.variantes = { data: [], error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarSonda() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(valor) => {
            api = valor;
          }}
        />,
      );
    });
  }

  it("fetchProduct propaga a falha das variações e encerra o carregamento", async () => {
    const erro = new Error("Falha na consulta de variações");
    mock.variantes = { data: null, error: erro };
    await montarSonda();
    await act(async () => {
      await expect(api.fetchProduct("prod-1")).rejects.toBe(erro);
    });
    expect(api.loading).toBe(false);
  });

  it("não abre formulário editável e usa o aviso de erro que já existe", async () => {
    mock.variantes = { data: null, error: new Error("Sem conexão") };
    const onNavigate = vi.fn();
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          productId="prod-1"
          onNavigate={onNavigate}
          onSetDirty={vi.fn()}
        />,
      );
    });
    expect(mock.toastError).toHaveBeenCalledWith(
      "Erro ao carregar produto. Verifique a conexão.",
    );
    expect(hospedeiro.textContent).toContain(
      "Não foi possível carregar este produto",
    );
    expect(hospedeiro.querySelector("form")).toBeNull();
    expect(hospedeiro.querySelector("#product-stock")).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("consulta bem-sucedida sem variações continua devolvendo produto simples", async () => {
    await montarSonda();
    await act(async () => {
      await expect(api.fetchProduct("prod-1")).resolves.toMatchObject({
        id: "prod-1",
        variants: [],
      });
    });
  });

  it("produto inexistente continua devolvendo null", async () => {
    mock.produto = { data: null, error: { code: "PGRST116" } };
    await montarSonda();
    await act(async () => {
      await expect(api.fetchProduct("prod-1")).resolves.toBeNull();
    });
  });
});
