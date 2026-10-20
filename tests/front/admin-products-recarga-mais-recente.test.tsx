import { publicarMudancaDeCategoria } from "@/lib/avisos-de-categoria";
import type { Product } from "@/types";
import { AdminProductsView } from "@/views/admin/AdminProductsView";
// @vitest-environment jsdom
import { act, useCallback, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { products: Product[]; total: number } | null;

function pendente() {
  let resolver!: (resultado: Resultado) => void;
  const promessa = new Promise<Resultado>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const consultar = vi.fn<() => Promise<Resultado>>();
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();

// Fronteira assíncrona do catálogo: callback estável e produtos só da geração
// atual, como useProducts. O estado de erro/carregamento da VIEW continua real.
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const geracao = useRef(0);
    const loadProducts = useCallback(async () => {
      const atual = ++geracao.current;
      setLoading(true);
      try {
        const resultado = await consultar();
        if (resultado && atual === geracao.current) {
          setProducts(resultado.products);
        }
        return atual === geracao.current ? resultado : null;
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

const produto: Product = {
  id: "produto-ficticio",
  name: "Produto atual",
  description: "Produto fictício para teste de recarga",
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
const vazio = { products: [], total: 0 };
const comProduto = { products: [produto], total: 1 };

describe("AdminProductsView — só a recarga atual conclui o estado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let montada: boolean;

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
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    montada = true;
  });

  afterEach(() => {
    if (montada) act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function montar(active = true) {
    await act(async () => {
      raiz.render(
        <AdminProductsView active={active} onNavigate={onNavigate} />,
      );
    });
  }

  async function iniciarPrimeira() {
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  async function recarregarPorCategoria() {
    // Caminho real: o catálogo permanece montado ao gerenciar categorias.
    // Não altera callback de hook nem acessa loadData privado.
    await act(async () => {
      publicarMudancaDeCategoria({ tipo: "apagada", nome: "Outra categoria" });
    });
  }

  it.each([
    ["com produto", comProduto, "Produto atual"],
    ["vazio legítimo", vazio, "Nenhum produto cadastrado"],
  ])(
    "B %s antes de A cancelada não vira falha",
    async (_, resultado, texto) => {
      const a = pendente();
      const b = pendente();
      consultar.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
      await iniciarPrimeira();
      await recarregarPorCategoria();
      expect(consultar).toHaveBeenCalledTimes(2);
      await act(async () => b.resolver(resultado));
      expect(hospedeiro.textContent).toContain(texto);
      expect(hospedeiro.textContent).toContain("Sincronizado");
      await act(async () => a.resolver(null));
      expect(hospedeiro.textContent).toContain(texto);
      expect(hospedeiro.textContent).toContain("Sincronizado");
      expect(hospedeiro.textContent).not.toContain("Não sincronizou");
      expect(hospedeiro.textContent).not.toContain("Erro ao Carregar Produtos");
    },
  );

  it("A cancelada antes de B não encerra o primeiro carregamento", async () => {
    const a = pendente();
    const b = pendente();
    consultar.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
    await iniciarPrimeira();
    await recarregarPorCategoria();
    await act(async () => a.resolver(null));
    expect(hospedeiro.querySelectorAll(".produto-esqueleto")).toHaveLength(12);
    expect(hospedeiro.textContent).not.toContain("Erro ao Carregar Produtos");
    await act(async () => b.resolver(comProduto));
    expect(hospedeiro.textContent).toContain("Produto atual");
    expect(hospedeiro.textContent).toContain("Sincronizado");
  });

  it("falha atual continua visível e tentar novamente recupera", async () => {
    consultar.mockResolvedValueOnce(null).mockResolvedValueOnce(comProduto);
    await iniciarPrimeira();
    expect(hospedeiro.textContent).toContain("Erro ao Carregar Produtos");
    const tentar = [...hospedeiro.querySelectorAll("button")].find((botao) =>
      botao.textContent?.includes("Novamente"),
    );
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());
    expect(hospedeiro.textContent).toContain("Produto atual");
    expect(hospedeiro.textContent).not.toContain("Erro ao Carregar Produtos");
    expect(hospedeiro.textContent).toContain("Sincronizado");
  });

  it("sucesso antigo não apaga falha da recarga atual", async () => {
    const a = pendente();
    const b = pendente();
    consultar.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
    await iniciarPrimeira();
    await recarregarPorCategoria();
    await act(async () => b.resolver(null));
    await act(async () => a.resolver(comProduto));
    expect(hospedeiro.textContent).toContain("Erro ao Carregar Produtos");
  });

  it("conclusão depois de desmontar não altera o total inicial da próxima tela", async () => {
    const a = pendente();
    consultar.mockReturnValueOnce(a.promessa);
    await iniciarPrimeira();
    act(() => raiz.unmount());
    montada = false;
    await act(async () => a.resolver({ products: [], total: 913 }));
    raiz = createRoot(hospedeiro);
    montada = true;
    await montar(false);
    expect(hospedeiro.textContent).not.toContain("913 itens");
  });
});
