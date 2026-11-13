// @vitest-environment jsdom
//
// `idDaContaViva` é a leitura SÍNCRONA de "quem está na conta agora" que o
// formulário de produto usa para não gravar, em nome de uma conta, uma edição
// que a conta anterior começou (outra aba trocou de conta durante a conferência
// do código de barras). O ponto que importa: uma referência ANTIGA à função
// (a que o handler do botão Salvar guardou quando nasceu) tem de enxergar a
// conta de AGORA, não a do render em que ela foi criada.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessao = vi.hoisted(() => ({
  user: { id: "conta-a" } as { id: string } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: sessao.user, isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (linha: unknown) => linha,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: () =>
        Promise.resolve({ data: { data: [], total_count: 0 }, error: null }),
    }),
    from: () => ({}),
    storage: { from: () => ({}) },
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
const renderizar = () => act(async () => raiz.render(<Sonda />));

beforeEach(async () => {
  sessao.user = { id: "conta-a" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await renderizar();
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("useProducts.idDaContaViva", () => {
  it("devolve a conta de quem está logado", () => {
    expect(api.idDaContaViva()).toBe("conta-a");
  });

  it("uma referência ANTIGA à função enxerga a conta de agora depois da troca", async () => {
    const guardadaNoCliqueDoSalvar = api.idDaContaViva;

    sessao.user = { id: "conta-b" };
    await renderizar();

    expect(guardadaNoCliqueDoSalvar()).toBe("conta-b");
  });

  it("a função é a mesma entre renderizações (não muda a identidade do que a tela guarda)", async () => {
    const antes = api.idDaContaViva;
    sessao.user = { id: "conta-b" };
    await renderizar();

    expect(api.idDaContaViva).toBe(antes);
  });

  it("sem ninguém logado devolve undefined (e o formulário trata como conta diferente)", async () => {
    sessao.user = null;
    await renderizar();

    expect(api.idDaContaViva()).toBeUndefined();
  });
});
