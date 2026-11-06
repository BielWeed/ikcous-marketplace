// @vitest-environment jsdom
//
// O buscador REAL (`fetchRecommendations`, dentro do `useProducts`) não pode
// responder "lista vazia" quando a função do banco dá erro: na página da
// cliente a lista local é sempre vazia, e [] era lido como "sem
// recomendações" (apagava a cópia boa). Erro tem de chegar a quem chamou.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  respostaDaFuncao: { data: null, error: { message: "boom" } } as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  },
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
    rpc: () => Promise.resolve(mock.respostaDaFuncao),
    from: () => {
      throw new Error("sem linhas, nenhuma consulta de variação esperada");
    },
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function obterBuscador() {
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
  return api!.fetchRecommendations;
}

describe("fetchRecommendations — erro do banco não vira 'sem recomendações'", () => {
  it("a função do banco dá erro: o buscador REJEITA (não devolve [])", async () => {
    mock.respostaDaFuncao = { data: null, error: { message: "boom" } };
    const buscar = await obterBuscador();
    await expect(buscar("pagina")).rejects.toBeDefined();
  });

  it("a função do banco responde vazio de verdade: devolve [] normalmente", async () => {
    mock.respostaDaFuncao = { data: [], error: null };
    const buscar = await obterBuscador();
    await expect(buscar("pagina")).resolves.toEqual([]);
  });
});
