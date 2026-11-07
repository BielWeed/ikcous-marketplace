// @vitest-environment jsdom
import type { Product } from "@/types";
import { AdminProductsView } from "@/views/admin/AdminProductsView";
import { act, useCallback, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { products: Product[]; total: number } | null;
const consultar = vi.fn<(...args: unknown[]) => Promise<Resultado>>();
const resumo = vi.fn();
const navegar = vi.fn();
let offline = false;
const ouvintes = new Set<() => void>();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const loadProducts = useCallback(async (...args: unknown[]) => {
      const filtros = args[2] as { silent?: boolean } | undefined;
      if (!filtros?.silent) setLoading(true);
      try {
        const resultado = await consultar(...args);
        if (resultado) setProducts(resultado.products);
        return resultado;
      } finally {
        setLoading(false);
      }
    }, []);
    const loadProductsSemCusto = useCallback(
      async (filters?: unknown) => consultar(0, 200, filters),
      [],
    );
    return { products, loading, loadProducts, loadProductsSemCusto };
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: resumo }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () =>
    useSyncExternalStore(
      (ouvinte) => {
        ouvintes.add(ouvinte);
        return () => ouvintes.delete(ouvinte);
      },
      () => offline,
    ),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: navegar }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(stock: number): Product {
  return {
    id: "produto-ficticio",
    name: "Produto fictício",
    description: "",
    category: "Geral",
    images: [],
    isActive: true,
    stock,
    price: 100,
    sold: 0,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-11-07T00:00:00.000Z",
  };
}

describe("Produtos — voltar do fundo", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    offline = false;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const storage = new Map<string, string>([
      ["admin_products_search_term", JSON.stringify("fictício")],
      ["admin_products_filter_category", JSON.stringify("Geral")],
      ["admin_products_current_page", JSON.stringify(1)],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    host = document.createElement("div");
    host.className = "admin-scroll-container";
    document.body.append(host);
    raiz = createRoot(host);
    consultar.mockResolvedValue({ products: [produto(3)], total: 30 });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function montar(active = true, visaoInicial?: string) {
    await act(async () =>
      raiz.render(
        <AdminProductsView
          active={active}
          onNavigate={navegar}
          visaoInicial={visaoInicial}
        />,
      ),
    );
  }
  async function esperar(ms: number) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  }
  async function voltar(evento = "visibilitychange") {
    await act(async () => {
      if (evento === "pageshow") window.dispatchEvent(new Event(evento));
      else document.dispatchEvent(new Event(evento));
    });
  }
  async function abrir(visaoInicial?: string) {
    await montar(true, visaoInicial);
    await esperar(320);
    resumo.mockClear();
  }

  it.each(["visibilitychange", "pageshow"])(
    "%s atualiza estoque sem perder página, busca ou categoria",
    async (evento) => {
      await abrir();
      const args = consultar.mock.calls[0];
      expect(args).toEqual([1, 12, { search: "fictício", category: "Geral" }]);
      expect(host.textContent).not.toContain("Esgotado");
      let resolver!: (valor: Resultado) => void;
      consultar.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolver = resolve;
          }),
      );
      await esperar(30_000);
      await voltar(evento);
      expect(consultar).toHaveBeenCalledTimes(2);
      expect(consultar.mock.calls[1]).toEqual([
        args[0],
        args[1],
        { ...(args[2] as object), silent: true },
      ]);
      await esperar(500);
      expect(host.querySelector('[aria-busy="true"]')).toBeNull();
      expect(host.textContent).toContain("Produto fictício");
      await act(async () => resolver({ products: [produto(0)], total: 30 }));
      expect(host.textContent).toContain("Esgotado");
      expect(resumo).toHaveBeenCalledWith(true);
    },
  );

  it("ignora retorno antes de 30 s e agrupa os dois eventos, inclusive durante carga lenta", async () => {
    await abrir();
    await esperar(29_999);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(1);
    await esperar(1);
    let resolver!: (valor: Resultado) => void;
    consultar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await voltar();
    await voltar("pageshow");
    await esperar(60_000);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(2);
    await act(async () => resolver({ products: [produto(0)], total: 30 }));
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(2);
    await esperar(30_000);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it("uma carga que nunca termina não bloqueia os retornos seguintes após 61 segundos", async () => {
    await abrir();
    consultar.mockImplementationOnce(() => new Promise<Resultado>(() => {}));
    consultar.mockResolvedValueOnce({ products: [produto(0)], total: 30 });
    await esperar(30_000);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(2);
    await esperar(59_999);
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(2);
    await esperar(1_001);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Esgotado");
  });

  it("a visão Sem custo espera cinco minutos entre retornos silenciosos", async () => {
    await abrir("sem-custo");
    await esperar(30_000);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(1);
    await esperar(269_999);
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(1);
    await esperar(1);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(2);
    await esperar(30_000);
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(2);
    await esperar(270_000);
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it("não recarrega escondido, offline nem com a aba de Produtos fechada", async () => {
    await abrir();
    await esperar(30_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await voltar();
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      offline = true;
      for (const ouvinte of ouvintes) ouvinte();
    });
    await voltar();
    expect(consultar).toHaveBeenCalledTimes(1);
    await montar(false);
    await voltar("pageshow");
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, 30_000],
    ["sem-custo", 300_000],
  ] as const)(
    "falha silenciosa na visão %s mantém a lista sem avisos e permite tentar após %i ms",
    async (visaoInicial, intervalo) => {
      await abrir(visaoInicial);
      consultar.mockResolvedValueOnce(null);
      await esperar(intervalo);
      await voltar();
      await voltar("pageshow");
      expect(consultar).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("Produto fictício");
      expect(host.textContent).not.toContain("Erro ao Carregar Produtos");
      expect(toast.error).not.toHaveBeenCalled();
      await esperar(intervalo);
      await voltar();
      expect(consultar).toHaveBeenCalledTimes(3);
    },
  );

  it("a confirmação de exclusão avisa para revisar banners com link para o produto", async () => {
    await abrir();
    const excluir = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Excluir Produto"),
    );
    expect(excluir).toBeDefined();
    await act(async () => excluir?.click());
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain(
      "Banners que apontam para este produto ficam com o link quebrado. Revise os banners após excluir.",
    );
  });
});
