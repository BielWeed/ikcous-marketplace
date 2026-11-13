// @vitest-environment jsdom
//
// Os avisos de criar, atualizar, remover e salvar uma variação diziam
// "Variante", mas a tela do produto e o glossário do painel dizem "variação".
// Uma palavra por coisa: os cinco avisos de sucesso usam "variação".
// (As frases "Validação de Variante Falhou" vêm do banco e não mudam.)
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => row,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));

// Cadeia que aceita qualquer encadeamento (select/eq/in/insert/update/delete/
// single) e termina numa linha de variação sem erro.
const LINHA = {
  id: "var-1",
  product_id: "prod-1",
  name: "Tamanho",
  value: "P",
  stock_increment: 5,
  price_override: null,
  active: true,
  sku: null,
  codigo_barras: null,
  image_url: null,
};
// Depois de `.delete()` o banco devolve as LINHAS apagadas (o hook pede com
// `.select("id")` e trata lista vazia como "não apagou").
function cadeia(apagando = false): any {
  const alvo = () => {};
  return new Proxy(alvo, {
    get: (_, prop) => {
      if (prop === "then") {
        return (ok: (v: unknown) => unknown) =>
          Promise.resolve({
            data: apagando ? [LINHA] : LINHA,
            error: null,
          }).then(ok);
      }
      return () => cadeia(apagando || prop === "delete");
    },
    apply: () => cadeia(apagando),
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => cadeia(),
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: Api) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

describe("useProducts — avisos de variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda onReady={(a) => (api = a)} />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    api = undefined;
  });

  it("criar uma variação avisa 'Variação adicionada'", async () => {
    await act(async () => {
      await api!.addVariant({
        productId: "prod-1",
        name: "Tamanho",
        value: "P",
        stockIncrement: 5,
        priceOverride: null,
        active: true,
      } as any);
    });
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variação adicionada");
  });

  it("atualizar uma variação avisa 'Variação atualizada'", async () => {
    await act(async () => {
      await api!.updateVariant("var-1", { stockIncrement: 7 });
    });
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variação atualizada");
  });

  it("remover uma variação avisa 'Variação removida'", async () => {
    await act(async () => {
      await api!.deleteVariant("var-1");
    });
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variação removida");
  });

  it("remover várias avisa 'Variações removidas'", async () => {
    await act(async () => {
      await api!.deleteVariants(["var-1", "var-2"]);
    });
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variações removidas");
  });
});
