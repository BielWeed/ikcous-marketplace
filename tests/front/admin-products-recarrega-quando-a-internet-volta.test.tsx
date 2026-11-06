import type { Product } from "@/types";
import { AdminProductsView } from "@/views/admin/AdminProductsView";
// @vitest-environment jsdom
import { act, useCallback, useState, useSyncExternalStore } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Defeito medido (autônomo r34): lista de produtos aberta, a internet cai e
// volta — o selo voltava a dizer "Sincronizado", mas a lista continuava com os
// produtos de antes da queda, porque nada a buscava de novo.

type Resultado = { products: Product[]; total: number } | null;

const consultar = vi.fn<() => Promise<Resultado>>();
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();
let semInternet = false;
// Assinatura de verdade (como useConnectionDiagnostics): a view é `memo`, então
// um dublê que só lê variável não a faria redesenhar quando o sinal muda.
const ouvintesDoSinal = new Set<() => void>();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const loadProducts = useCallback(async () => {
      setLoading(true);
      try {
        const resultado = await consultar();
        if (resultado) setProducts(resultado.products);
        return resultado;
      } finally {
        setLoading(false);
      }
    }, []);
    return { products, loading, loadProducts };
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () =>
    useSyncExternalStore(
      (ouvinte) => {
        ouvintesDoSinal.add(ouvinte);
        return () => ouvintesDoSinal.delete(ouvinte);
      },
      () => semInternet,
    ),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: onNavigate }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, name: string): Product {
  return {
    id,
    name,
    description: "Produto fictício para teste de reconexão",
    category: "Geral",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
    sold: 0,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-10-20T00:00:00.000Z",
  };
}

describe("AdminProductsView — recarrega a lista quando a internet volta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    semInternet = false;
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function desenhar(active = true) {
    await act(async () => {
      raiz.render(
        <AdminProductsView active={active} onNavigate={onNavigate} />,
      );
    });
  }

  async function mudarSinal(offline: boolean, active = true) {
    semInternet = offline;
    await act(async () => {
      for (const ouvinte of ouvintesDoSinal) ouvinte();
    });
    await desenhar(active);
  }

  async function primeiraCarga() {
    await desenhar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  it("cai e volta: busca a lista de novo e mostra os produtos atuais", async () => {
    consultar
      .mockResolvedValueOnce({
        products: [produto("a", "Produto de antes da queda")],
        total: 1,
      })
      .mockResolvedValueOnce({
        products: [produto("b", "Produto de depois da queda")],
        total: 1,
      });
    await primeiraCarga();
    expect(hospedeiro.textContent).toContain("Produto de antes da queda");
    expect(consultar).toHaveBeenCalledTimes(1);

    await mudarSinal(true);
    expect(consultar).toHaveBeenCalledTimes(1);

    await mudarSinal(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("Produto de depois da queda");
    expect(hospedeiro.textContent).not.toContain("Produto de antes da queda");
    expect(hospedeiro.textContent).toContain("Sincronizado");
  });

  it("sem queda de sinal, redesenhar não busca de novo", async () => {
    consultar.mockResolvedValue({
      products: [produto("a", "Produto de antes da queda")],
      total: 1,
    });
    await primeiraCarga();
    await mudarSinal(false);
    await mudarSinal(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it("o sinal volta com a tela fechada: não busca escondido", async () => {
    consultar.mockResolvedValue({
      products: [produto("a", "Produto de antes da queda")],
      total: 1,
    });
    await primeiraCarga();
    await mudarSinal(true, false);
    await mudarSinal(false, false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
