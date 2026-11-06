// @vitest-environment jsdom
//
// Link de edição com o id do produto TRUNCADO (não é um uuid) volta do banco
// com 22P02 ("invalid input syntax for type uuid"), não com PGRST116. Os dois
// dizem a mesma coisa: esse produto não existe. Antes, só o PGRST116 virava
// "não existe" (`null`); o 22P02 ia para o `throw` e a tela de edição dizia
// "Verifique a conexão" para um link que nunca vai funcionar — e o botão
// tentava o mesmo link de novo. Falha de verdade (rede, 500) continua lançando.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  erro: null as { code?: string; message: string } | null,
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
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tabela: string) => {
      if (tabela !== "vw_produtos_admin")
        throw new Error(`Tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const consulta = {
            eq: () => consulta,
            is: () => consulta,
            single: async () => ({ data: null, error: banco.erro }),
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;
let api: Api;
function Sonda() {
  const hook = useProducts({ autoFetch: false });
  useEffect(() => {
    api = hook;
  });
  return null;
}

describe("useProducts.fetchProduct: id que não existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PGRST116 (nenhuma linha): produto não existe, devolve null", async () => {
    banco.erro = { code: "PGRST116", message: "0 rows" };
    let resultado: unknown = "nao-rodou";
    await act(async () => {
      resultado = await api.fetchProduct(
        "11111111-1111-1111-1111-111111111111",
      );
    });
    expect(resultado).toBeNull();
  });

  it("22P02 (id truncado, não é uuid): produto não existe, devolve null", async () => {
    banco.erro = {
      code: "22P02",
      message: 'invalid input syntax for type uuid: "1111"',
    };
    let resultado: unknown = "nao-rodou";
    let lancou: unknown;
    await act(async () => {
      try {
        resultado = await api.fetchProduct("1111");
      } catch (e) {
        lancou = e;
      }
    });
    expect(lancou).toBeUndefined();
    expect(resultado).toBeNull();
  });

  it("controle: falha de verdade (outro código) continua lançando", async () => {
    banco.erro = { code: "08006", message: "connection failure" };
    let lancou: unknown;
    await act(async () => {
      try {
        await api.fetchProduct("11111111-1111-1111-1111-111111111111");
      } catch (e) {
        lancou = e;
      }
    });
    expect(lancou).toMatchObject({ code: "08006" });
  });
});
