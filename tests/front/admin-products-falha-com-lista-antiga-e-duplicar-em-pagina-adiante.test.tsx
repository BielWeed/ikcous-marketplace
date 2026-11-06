// @vitest-environment jsdom
//
// Dois defeitos da lista de Produtos que só aparecem com a lista JÁ na tela:
//
// 1) Falha ao buscar (internet caiu ao trocar de categoria, página ou busca):
//    a lista antiga ficava na tela como se fosse o resultado novo e o aviso
//    "Tentar Novamente" só existia com a lista vazia. Agora o aviso aparece
//    também com lista antiga, dizendo que ela é de antes do que foi pedido.
// 2) Duplicar estando numa página adiante: a cópia (a mais recente) nasce na
//    página 1 e sumia de vista. Agora a lista volta à página 1, como o
//    cadastro de produto novo já faz.
import { publicarMudancaDeCategoria } from "@/lib/avisos-de-categoria";
import type { Product } from "@/types";
import { AdminProductsView } from "@/views/admin/AdminProductsView";
import { act, useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { products: Product[]; total: number } | null;

const consultar = vi.fn<(pagina: number) => Promise<Resultado>>();
const addProduct = vi.fn();
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();

// Fronteira assíncrona do catálogo, como em admin-products-recarga-mais-recente:
// os produtos só mudam quando a leitura dá certo (falha deixa a lista antiga).
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const geracao = useRef(0);
    const loadProducts = useCallback(async (pagina: number) => {
      const atual = ++geracao.current;
      setLoading(true);
      try {
        const resultado = await consultar(pagina);
        if (resultado && atual === geracao.current) {
          setProducts(resultado.products);
        }
        return atual === geracao.current ? resultado : null;
      } finally {
        setLoading(false);
      }
    }, []);
    return {
      products,
      loading,
      loadProducts,
      addProduct,
      copiarImagemParaDuplicacao: async (url: string) => url,
    };
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
// Menu e diálogo viram HTML simples: o clique de "Duplicar" e o de confirmar
// ficam alcançáveis sem Radix (mesmo dublê de admin-products-duplicar-*).
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
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Caixa = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  const Botao = ({
    children,
    onClick,
    "aria-label": rotulo,
  }: {
    children: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={rotulo}>
      {children}
    </button>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: ReactNode;
    }) => (open ? <div>{children}</div> : null),
    AlertDialogContent: Caixa,
    AlertDialogHeader: Caixa,
    AlertDialogFooter: Caixa,
    AlertDialogTitle: Caixa,
    AlertDialogDescription: Caixa,
    AlertDialogAction: Botao,
    AlertDialogCancel: Botao,
  };
});
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
  description: "Produto fictício",
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
const comProduto = { products: [produto], total: 40 };

describe("AdminProductsView — lista antiga e duplicar em página adiante", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

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
    armazem = new Map<string, string>();
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function abrirEEsperarALista() {
    await act(async () => {
      raiz.render(<AdminProductsView active={true} onNavigate={onNavigate} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  function botaoPorTexto(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === texto ||
        b.textContent?.includes(texto),
    );
  }

  describe("falha ao buscar com a lista antiga na tela", () => {
    it("mostra o aviso com Tentar Novamente, e tentar de novo recupera", async () => {
      consultar
        .mockResolvedValueOnce(comProduto)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(comProduto);
      await abrirEEsperarALista();
      expect(hospedeiro.textContent).toContain("Produto atual");
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();

      // A internet cai ao recarregar (aqui, por mudança de categoria).
      await act(async () => {
        publicarMudancaDeCategoria({ tipo: "apagada", nome: "Outra" });
      });

      const alerta = hospedeiro.querySelector('[role="alert"]');
      expect(alerta).not.toBeNull();
      expect(alerta?.textContent).toContain("Erro ao Carregar Produtos");
      // A lista que continua na tela é de antes: o aviso diz isso.
      expect(alerta?.textContent).toContain("de antes");
      expect(hospedeiro.textContent).toContain("Produto atual");

      const tentar = botaoPorTexto("Tentar Novamente");
      expect(tentar).toBeDefined();
      await act(async () => tentar?.click());
      expect(consultar).toHaveBeenCalledTimes(3);
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
      expect(hospedeiro.textContent).not.toContain("Erro ao Carregar Produtos");
    });
  });

  describe("duplicar estando numa página adiante", () => {
    async function duplicar() {
      await act(async () => botaoPorTexto("Duplicar Produto")?.click());
      const confirmar = botaoPorTexto("Duplicar Produto: confirmar duplicação");
      expect(confirmar).toBeDefined();
      await act(async () => confirmar?.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }

    it("volta para a página 1, onde a cópia (a mais recente) aparece", async () => {
      armazem.set("admin_products_current_page", "2");
      consultar.mockResolvedValue(comProduto);
      addProduct.mockResolvedValue({ id: "copia-1" });
      await abrirEEsperarALista();
      expect(consultar).toHaveBeenLastCalledWith(2);

      await duplicar();

      expect(addProduct).toHaveBeenCalledTimes(1);
      expect(consultar).toHaveBeenLastCalledWith(0);
    });

    it("na página 1 recarrega a própria página 1, sem mudar de página", async () => {
      consultar.mockResolvedValue(comProduto);
      addProduct.mockResolvedValue({ id: "copia-1" });
      await abrirEEsperarALista();
      expect(consultar).toHaveBeenLastCalledWith(0);
      consultar.mockClear();

      await duplicar();

      expect(consultar).toHaveBeenCalled();
      for (const [pagina] of consultar.mock.calls) expect(pagina).toBe(0);
    });
  });
});
