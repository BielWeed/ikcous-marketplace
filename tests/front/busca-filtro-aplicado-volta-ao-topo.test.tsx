// @vitest-environment jsdom
//
// Na Busca, a cliente rola várias linhas, abre "Filtros", muda a ordenação e toca
// "Aplicar Filtros": a lista passava a mostrar só os 12 primeiros da nova ordem,
// mas a página ficava na posição antiga (no meio ou no fim). Agora uma mudança de
// verdade nos filtros também leva a rolagem ao topo dos resultados -- e só ela:
// carregar mais por rolagem, montar a tela e voltar de um produto não mexem na
// posição da cliente.
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

// Mesmo dublê de Sheet dos testes vizinhos da Busca.
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

const observadores: Array<{
  ativo: boolean;
  aviso: (entradas: Array<{ isIntersecting: boolean }>) => void;
}> = [];

describe("SearchView: aplicar filtro leva a lista de volta ao topo", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let lembrada: QuantidadeDaBusca | null;
  // O jsdom não implementa `scrollIntoView`: o dublê guarda também em quem foi
  // chamado (`this`), para provar que a rolagem mira a lista de resultados.
  let rolagem: ReturnType<typeof vi.fn>;

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
    rolagem = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: rolagem,
    });
    lembrada = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
    // biome-ignore lint/performance/noDelete: devolve o jsdom ao estado original.
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  });

  const esperar = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  };

  const exibidos = () =>
    host.querySelectorAll('[data-testid="resultado"]').length;

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

  const botoes = () => Array.from(host.querySelectorAll("button"));
  const clicar = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  const botaoComTexto = (texto: string, inicio = false) =>
    botoes().find((b) =>
      inicio ? b.textContent?.startsWith(texto) : b.textContent === texto,
    ) as HTMLElement;

  it("rolou várias linhas, mudou a ordenação e aplicou: volta ao topo dos resultados", async () => {
    await montar("camisa");
    await carregarMais();
    expect(exibidos()).toBe(24);
    rolagem.mockClear();

    await clicar(botaoComTexto("Filtros", true));
    await clicar(botaoComTexto("Menor Preço"));
    await clicar(botaoComTexto("Aplicar Filtros"));

    expect(exibidos()).toBe(12);
    expect(rolagem).toHaveBeenCalled();
    // A rolagem mira a lista (e só ela), não o cabeçalho nem a página inteira.
    const alvo = rolagem.mock.contexts.at(-1) as HTMLElement;
    expect(host.contains(alvo)).toBe(true);
    expect(alvo.querySelectorAll('[data-testid="resultado"]').length).toBe(12);
    expect(alvo.querySelector("input")).toBeNull();
  });

  it("buscar outro termo na própria tela também volta ao topo", async () => {
    await montar("camisa");
    rolagem.mockClear();

    await montar("azul");

    expect(rolagem).toHaveBeenCalled();
  });

  it("carregar mais resultados rolando a lista NÃO rola de volta ao topo", async () => {
    await montar("camisa");
    rolagem.mockClear();

    await carregarMais();
    await carregarMais();

    expect(exibidos()).toBe(36);
    expect(rolagem).not.toHaveBeenCalled();
  });

  it("montar a tela não rola, nem ao voltar do produto com a lista já carregada", async () => {
    await montar("camisa");
    await carregarMais();
    expect(rolagem).not.toHaveBeenCalled();

    // Abrir o produto desmonta a tela; voltar monta outra (o App devolve a
    // quantidade e a rolagem guardada, que a tela não pode desfazer).
    await act(async () => {
      raiz.render(<div />);
    });
    await esperar();
    await montar("camisa");

    expect(exibidos()).toBe(24);
    expect(rolagem).not.toHaveBeenCalled();
  });

  it("tocar de novo na ordenação que já está escolhida não rola", async () => {
    await montar("camisa");
    await clicar(botaoComTexto("Filtros", true));
    // "Relevância" (termo preenchido) é a ordem padrão, já escolhida.
    await clicar(botaoComTexto("Relevância"));
    await clicar(botaoComTexto("Aplicar Filtros"));

    expect(rolagem).not.toHaveBeenCalled();
  });
});
