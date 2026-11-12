// @vitest-environment jsdom
//
// A busca mostra 12 produtos e carrega mais conforme a cliente rola. Ao abrir
// um produto a tela é desmontada e, ao voltar, remontava com só os 12 primeiros:
// a rolagem guardada pelo App era aplicada numa lista curta e a cliente perdia o
// lugar onde estava. Agora a quantidade já exibida também fica guardada fora da
// tela (como categoria e ordem) e volta junto, presa ao termo a que pertence.
//
// O teste faz o papel do App com uma variável do lado de fora: monta, carrega
// mais, desmonta (o produto abre) e monta de novo (a cliente voltou).
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuantidadeDaBusca } from "@/hooks/useSearch";
import type { Product } from "@/types";
import { SearchView } from "@/views/customer/SearchView";

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, nome: string, preco: number): Product {
  return {
    id,
    name: nome,
    description: "",
    price: preco,
    images: [],
    category: "Geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

// 40 camisas: 20 azuis e 20 verdes. "camisa" acha 40; "azul" acha 20.
const catalogo: Product[] = Array.from({ length: 40 }, (_, i) =>
  produto(
    `p${String(i).padStart(2, "0")}`,
    `Camisa ${i % 2 === 0 ? "Azul" : "Verde"} ${i}`,
    10 + i,
  ),
);

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="resultado">{product.id}</span>
  ),
}));

// Mesmo dublê de Sheet de search-view-filtros-sobrevivem-a-abrir-produto-e-voltar.
const SheetOpenContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}>({ open: false });
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <SheetOpenContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetOpenContext.Provider>
  ),
  SheetTrigger: ({ children }: { asChild?: boolean; children: ReactNode }) => {
    const { onOpenChange } = useContext(SheetOpenContext);
    if (!isValidElement(children)) return children;
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange?.(true),
    });
  },
  SheetContent: ({ children }: { children: ReactNode }) => {
    const { open } = useContext(SheetOpenContext);
    return open ? <div>{children}</div> : null;
  },
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// O jsdom não tem IntersectionObserver: este dublê guarda quem observa para o
// teste "rolar até o fim" chamando o aviso de interseção do que está ativo.
const observadores: Array<{
  ativo: boolean;
  aviso: (entradas: Array<{ isIntersecting: boolean }>) => void;
}> = [];

describe("SearchView: voltar do produto mantém a lista já carregada", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  // O que o App guarda entre uma visita à tela e a outra.
  let lembrada: QuantidadeDaBusca | null;

  beforeEach(() => {
    observadores.length = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly dono: (typeof observadores)[number];
        constructor(
          aviso: (entradas: Array<{ isIntersecting: boolean }>) => void,
        ) {
          this.dono = { ativo: true, aviso };
          observadores.push(this.dono);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          this.dono.ativo = false;
        }
        takeRecords() {
          return [];
        }
      },
    );
    lembrada = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const esperar = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  };

  const exibidos = () =>
    host.querySelectorAll('[data-testid="resultado"]').length;

  // Uma "rolagem até o fim": o sentinela entra na tela e a lista carrega mais.
  async function carregarMais() {
    const ativo = observadores.filter((o) => o.ativo).at(-1);
    expect(ativo, "sentinela de carregar mais ausente").toBeDefined();
    await act(async () => {
      ativo?.aviso([{ isIntersecting: true }]);
    });
  }

  async function montar(termo: string) {
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery={termo}
          onQueryChange={() => {}}
          quantidadeInicial={lembrada ?? undefined}
          aoMudarQuantidade={(q: QuantidadeDaBusca) => {
            lembrada = q;
          }}
        />,
      );
    });
    await esperar();
  }

  // Abrir o produto desmonta a tela; voltar monta outra do zero.
  async function abrirProdutoEVoltar(termo: string) {
    await act(async () => {
      raiz.render(<div />);
    });
    await esperar();
    await montar(termo);
  }

  it("rolou até o 36º, abriu o produto e voltou: continuam os 36 já carregados", async () => {
    await montar("camisa");
    expect(exibidos()).toBe(12);
    await carregarMais();
    await carregarMais();
    expect(exibidos()).toBe(36);

    await abrirProdutoEVoltar("camisa");

    expect(exibidos()).toBe(36);
  });

  it("termo diferente do guardado volta ao padrão de 12", async () => {
    await montar("camisa");
    await carregarMais();
    await carregarMais();
    expect(exibidos()).toBe(36);

    // A cliente voltou com outra busca (20 achados): não herda os 36.
    await abrirProdutoEVoltar("azul");

    expect(exibidos()).toBe(12);
  });

  it("nova busca digitada na própria tela volta ao padrão de 12", async () => {
    await montar("camisa");
    await carregarMais();
    expect(exibidos()).toBe(24);

    await montar("azul");

    expect(exibidos()).toBe(12);
  });

  it("mudar a ordem volta ao padrão de 12", async () => {
    await montar("camisa");
    await carregarMais();
    expect(exibidos()).toBe(24);

    const botoes = () => Array.from(host.querySelectorAll("button"));
    const clicar = async (el: HTMLElement) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    await clicar(
      botoes().find((b) => b.textContent?.startsWith("Filtros")) as HTMLElement,
    );
    await clicar(
      botoes().find((b) => b.textContent === "Menor Preço") as HTMLElement,
    );

    expect(exibidos()).toBe(12);
  });

  it("LIMITE: guardado maior que o total de resultados mostra só o que existe", async () => {
    lembrada = { termo: "azul", quantidade: 36 };

    await montar("azul");

    expect(exibidos()).toBe(20);
    expect(host.textContent).toContain("Encontramos 20 resultados");
  });

  it("LIMITE: sem nada guardado (primeira visita) a tela abre com 12", async () => {
    await montar("camisa");

    expect(exibidos()).toBe(12);
  });
});
