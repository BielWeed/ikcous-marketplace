// @vitest-environment jsdom
//
// A peca que volta sem tamanho (20261642000000): a lista de produtos mostra, no
// cartao do produto, quantas pecas esperam a lojista escolher o tamanho. Ids e
// nomes inventados (repositorio publico).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const rpc = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; args: unknown }>,
  pendentes: [] as Record<string, unknown>[],
}));
const onNavigate = vi.fn();
let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "l-1" } } } }),
    },
    rpc: async (nome: string, args: unknown) => {
      rpc.chamadas.push({ nome, args });
      if (nome !== "pecas_sem_tamanho_pendentes")
        throw new Error(`RPC inesperada: ${nome}`);
      return { data: rpc.pendentes, error: null };
    },
  },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let modo = "detailed";

function linha(id: string, produto: string) {
  return {
    id,
    produto_id: produto,
    order_id: "00000000-0000-4000-8000-00000000a1b2",
    origem: "devolucao",
    criada_em: "2026-11-27T12:00:00+00:00",
  };
}
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  // A loja tem banco configurado (o hook nem importa o cliente sem URL e chave).
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
  vi.clearAllMocks();
  produtosMock = [
    {
      id: "prod-1",
      name: "Blusa de teste",
      category: "Blusas",
      images: [],
      isActive: true,
      stock: 4,
      price: 15,
      costPrice: 10,
      estoqueMinimo: null,
    },
    {
      id: "prod-2",
      name: "Saia de teste",
      category: "Saias",
      images: [],
      isActive: true,
      stock: 4,
      price: 15,
      costPrice: 10,
      estoqueMinimo: null,
    },
  ];
  rpc.chamadas = [];
  rpc.pendentes = [linha("x-1", "prod-1"), linha("x-2", "prod-1")];
  loadProducts.mockImplementation(async () => ({
    products: produtosMock,
    total: 2,
  }));
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const armazem = new Map<string, string>([["admin_products_view_mode", modo]]);
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  });
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

async function montar() {
  const { AdminProductsView } = await import("@/views/admin/AdminProductsView");
  await act(async () => {
    raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function cartaoDe(nome: string): HTMLElement {
  const alvo = [...hospedeiro.querySelectorAll("[data-produto-nome]")].find(
    (n) => n.textContent?.includes(nome),
  );
  expect(alvo, nome).toBeDefined();
  return alvo!.closest(".group") as HTMLElement;
}

for (const m of ["detailed", "compact"]) {
  it(`modo ${m}: o selo diz quantas pecas esperam, so no produto delas`, async () => {
    modo = m;
    await montar();
    expect(rpc.chamadas).toEqual([
      { nome: "pecas_sem_tamanho_pendentes", args: {} },
    ]);
    expect(cartaoDe("Blusa de teste").textContent).toContain(
      "2 peças sem tamanho",
    );
    expect(cartaoDe("Saia de teste").textContent).not.toContain("sem tamanho");
  });
}

it("uma peca so: singular", async () => {
  modo = "detailed";
  rpc.pendentes = [linha("x-1", "prod-2")];
  await montar();
  expect(cartaoDe("Saia de teste").textContent).toContain("1 peça sem tamanho");
  expect(cartaoDe("Blusa de teste").textContent).not.toContain("sem tamanho");
});

it("lista atras de outra aba nao pergunta; ao voltar a ficar ativa, pergunta de novo", async () => {
  modo = "detailed";
  const { AdminProductsView } = await import("@/views/admin/AdminProductsView");
  const render = async (active: boolean) => {
    await act(async () => {
      raiz.render(
        <AdminProductsView onNavigate={onNavigate} active={active} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await render(false);
  expect(rpc.chamadas).toEqual([]);
  await render(true);
  expect(rpc.chamadas).toHaveLength(1);
  // A lojista vai a tela do produto, decide as duas pecas e volta para a lista.
  await render(false);
  rpc.pendentes = [];
  await render(true);
  expect(rpc.chamadas).toHaveLength(2);
  expect(cartaoDe("Blusa de teste").textContent).not.toContain("sem tamanho");
});
