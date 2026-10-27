// @vitest-environment jsdom
//
// Caça 9, item 15 — duplicar produto emitia DOIS avisos de sucesso: o do hook
// ("Produto cadastrado com sucesso!", dentro de `addProduct`) e o da tela
// ("Produto Duplicado"). A tela de duplicar pede ao hook para calar o dele;
// quem cadastra pelo formulário (sem a opção) continua recebendo o aviso.
// Hook REAL, Supabase simulado.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  insercaoFalha: false,
  inseridos: [] as any[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "lojista-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => ({
    id: row.id,
    name: row.nome,
    price: row.preco_venda,
    stock: row.estoque,
    images: row.imagem_urls ?? [],
    variants: [],
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      insert: (payload: any) => {
        mock.inseridos.push({ tabela, payload });
        return {
          select: () => ({
            single: async () =>
              mock.insercaoFalha
                ? { data: null, error: { message: "falhou" } }
                : {
                    data: {
                      id: "copia-1",
                      nome: payload.nome,
                      preco_venda: payload.preco_venda,
                      estoque: payload.estoque,
                      imagem_urls: [],
                    },
                    error: null,
                  },
          }),
        };
      },
    }),
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

const dados = {
  name: "Camiseta (Cópia)",
  description: "",
  price: 50,
  stock: 3,
  category: "Geral",
  images: [],
  isActive: false,
  sold: 0,
  isBestseller: false,
  freeShipping: false,
  tags: [],
} as any;

describe("useProducts.addProduct — aviso de sucesso opcional", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.insercaoFalha = false;
    mock.inseridos = [];
    api = undefined;
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(a) => {
            api = a;
          }}
        />,
      );
    });
  }

  it("sem a opção, cadastrar avisa o sucesso (formulário de produto não muda)", async () => {
    await montar();
    let criado: any;
    await act(async () => {
      criado = await api!.addProduct(dados);
    });
    expect(criado?.id).toBe("copia-1");
    expect(mock.toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Produto cadastrado com sucesso!",
    );
  });

  it("com avisarSucesso: false, cria o produto e NÃO emite o aviso de sucesso", async () => {
    await montar();
    let criado: any;
    await act(async () => {
      criado = await api!.addProduct(dados, { avisarSucesso: false });
    });
    expect(criado?.id).toBe("copia-1");
    expect(mock.inseridos).toHaveLength(1);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).not.toHaveBeenCalled();
  });

  it("com avisarSucesso: false, a FALHA continua avisando (calar é só do sucesso)", async () => {
    await montar();
    mock.insercaoFalha = true;
    await act(async () => {
      await expect(
        api!.addProduct(dados, { avisarSucesso: false }),
      ).rejects.toBeDefined();
    });
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
  });
});
