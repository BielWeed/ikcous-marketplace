// @vitest-environment jsdom
//
// Regressão: a resposta de uma página extinta da categoria A não pode corrigir
// a página da categoria B escolhida enquanto a leitura de A estava pendente.
// A view, a barra de categorias e a paginação são reais; só a fronteira de
// leitura do catálogo é controlada. Nenhuma exclusão ou backend é executado.
import type { Product } from "@/types";
import { AdminProductsView } from "@/views/admin/AdminProductsView";
import { act, useCallback, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { products: Product[]; total: number } | null;
type Filtros = { search?: string; category?: string; silent?: boolean };

function pendente() {
  let resolver!: (resultado: Resultado) => void;
  const promessa = new Promise<Resultado>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const consultar =
  vi.fn<
    (pagina: number, tamanho: number, filtros?: Filtros) => Promise<Resultado>
  >();
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();
const categorias = [{ name: "Categoria A" }, { name: "Categoria B" }];

// Mesma fronteira dos testes vizinhos: o hook só supera a consulta anterior
// quando OUTRA consulta começa, não quando a view troca o filtro. Não antecipa
// a correção da view nem expõe seu loadData privado ao teste.
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const geracao = useRef(0);
    const loadProducts = useCallback(
      async (pagina: number, tamanho: number, filtros?: Filtros) => {
        const atual = ++geracao.current;
        setLoading(true);
        try {
          const resultado = await consultar(pagina, tamanho, filtros);
          if (atual !== geracao.current) return null;
          if (resultado) setProducts(resultado.products);
          return resultado;
        } finally {
          if (atual === geracao.current) setLoading(false);
        }
      },
      [],
    );
    return { products, loading, loadProducts };
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: categorias }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
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

function produto(id: string, name: string, category: string): Product {
  return {
    id,
    name,
    category,
    description: "Produto fictício para teste de categoria e paginação",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
    sold: 0,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-11-09T00:00:00.000Z",
  };
}

const primeiraDeA = Array.from({ length: 12 }, (_, indice) =>
  produto(`a-${indice + 1}`, `Produto A ${indice + 1}`, "Categoria A"),
);
const paginaAnteriorDeA = Array.from({ length: 12 }, (_, indice) =>
  produto(`a-${indice + 13}`, `Produto A ${indice + 13}`, "Categoria A"),
);
const primeiraDeB = Array.from({ length: 12 }, (_, indice) =>
  produto(`b-${indice + 1}`, `Produto B ${indice + 1}`, "Categoria B"),
);
const segundaDeB = Array.from({ length: 12 }, (_, indice) =>
  produto(`b-${indice + 13}`, `Produto B ${indice + 13}`, "Categoria B"),
);

describe("AdminProductsView — resposta antiga não muda a página de outra categoria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
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
    // Página 3 de A lembrada no aparelho. O produto 25 acabou de ser removido
    // no servidor: a leitura controlada devolverá total 24 e página vazia.
    const armazem = new Map<string, string>([
      ["admin_products_filter_category", JSON.stringify("Categoria A")],
      ["admin_products_current_page", "2"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    fetchExecutiveSummary.mockResolvedValue(null);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function prepararLeitura(a: ReturnType<typeof pendente>) {
    consultar.mockImplementation(async (pagina, tamanho, filtros) => {
      if (tamanho !== 12) throw new Error("Tamanho de página inesperado");
      if (filtros?.category === "Categoria A" && pagina === 2) {
        return a.promessa;
      }
      if (filtros?.category === "Categoria A" && pagina === 0) {
        return { products: primeiraDeA, total: 24 };
      }
      if (filtros?.category === "Categoria A" && pagina === 1) {
        return { products: paginaAnteriorDeA, total: 24 };
      }
      if (filtros?.category === "Categoria B" && pagina === 0) {
        return { products: primeiraDeB, total: 36 };
      }
      if (filtros?.category === "Categoria B" && pagina === 1) {
        return { products: segundaDeB, total: 36 };
      }
      throw new Error("Consulta fora do cenário de teste");
    });
  }

  async function abrirNaPaginaExtinta(a: ReturnType<typeof pendente>) {
    prepararLeitura(a);
    await act(async () => {
      raiz.render(<AdminProductsView active={true} onNavigate={onNavigate} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar).toHaveBeenLastCalledWith(2, 12, {
      search: undefined,
      category: "Categoria A",
    });
  }

  function paginacao() {
    return hospedeiro.querySelector('[data-testid="paginacao-admin"]');
  }

  it("abre B na primeira página mesmo se A corrigir sua página durante o debounce", async () => {
    const a = pendente();
    await abrirNaPaginaExtinta(a);
    // Interação na faixa REAL: carregando apenas desenha o ícone; não há
    // dublê de BarraDeBusca nem chamada direta ao callback de categoria.
    const faixa = hospedeiro.querySelector(
      '[role="group"][aria-label="Categorias dos produtos"]',
    );
    const categoriaB = Array.from(faixa?.querySelectorAll("button") ?? []).find(
      (botao) => botao.textContent?.trim() === "Categoria B",
    );
    expect(categoriaB).toBeDefined();
    if (!categoriaB) throw new Error("Categoria B não apareceu na faixa real");
    expect(categoriaB.matches(":disabled")).toBe(false);
    await act(async () => categoriaB.click());
    expect(categoriaB.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // A chega antes dos 320 ms de B. Nenhuma consulta nova começou para
    // abortar A; quem deve rejeitar a correção obsoleta é a view real.
    expect(consultar).toHaveBeenCalledTimes(1);
    await act(async () => a.resolver({ products: [], total: 24 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    const consultasDeB = consultar.mock.calls.filter(
      ([, , filtros]) => filtros?.category === "Categoria B",
    );
    expect(consultasDeB.map(([pagina]) => pagina)).toEqual([0]);
    expect(hospedeiro.textContent).toContain("Produto B 1");
    expect(hospedeiro.textContent).not.toContain("Produto B 13");
    expect(paginacao()?.textContent).toContain("Exibindo 1 - 12 de 36");
  });

  it("volta para A antes dos 320 ms: a resposta velha de A também não muda a página", async () => {
    const a = pendente();
    await abrirNaPaginaExtinta(a);
    const faixa = hospedeiro.querySelector(
      '[role="group"][aria-label="Categorias dos produtos"]',
    );
    const botao = (nome: string) =>
      Array.from(faixa?.querySelectorAll("button") ?? []).find(
        (item) => item.textContent?.trim() === nome,
      );
    const categoriaB = botao("Categoria B");
    const categoriaA = botao("Categoria A");
    if (!categoriaA || !categoriaB) throw new Error("Faixa real incompleta");
    await act(async () => categoriaB.click());
    await act(async () => categoriaA.click());
    expect(categoriaA.getAttribute("aria-pressed")).toBe("true");

    // O filtro voltou ao valor antigo, mas a troca aconteceu: a resposta da
    // leitura iniciada antes dela não pode puxar a página para 1.
    await act(async () => a.resolver({ products: [], total: 24 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    const paginasDeA = consultar.mock.calls
      .filter(([, , filtros]) => filtros?.category === "Categoria A")
      .map(([pagina]) => pagina);
    expect(paginasDeA).toEqual([2, 0]);
    expect(hospedeiro.textContent).toContain("Produto A 1");
    expect(hospedeiro.textContent).not.toContain("Produto A 13");
  });

  it("ainda corrige a página extinta quando a categoria continua sendo A", async () => {
    const a = pendente();
    await abrirNaPaginaExtinta(a);
    await act(async () => a.resolver({ products: [], total: 24 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    expect(consultar).toHaveBeenLastCalledWith(1, 12, {
      search: undefined,
      category: "Categoria A",
    });
    expect(hospedeiro.textContent).toContain("Produto A 13");
    expect(paginacao()?.textContent).toContain("Exibindo 13 - 24 de 24");
  });
});
