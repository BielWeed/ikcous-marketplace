// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 7: filtros e pílulas da busca eram botões "mudos"
// (sem estado marcado para o leitor de tela), com alvo de ~32 px; a contagem de
// resultados não era anunciada. Mocks copiados de limpar-tudo-limpa-de-verdade
// (Sheet sem Radix: o jsdom do projeto não tem PointerEvent/ResizeObserver).
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const itemNoCarrinho: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));

// Único produto do catálogo de teste, usado só pelo achado 2 (o botão
// "Limpar Tudo" do painel "Refinar Busca"): precisa de uma categoria
// diferente de "Todas" para o painel ter algo para filtrar.
const produtoVestido: Product = {
  id: "prod-vestido",
  name: "Vestido Floral",
  description: "",
  price: 150,
  images: [],
  category: "Vestidos",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

// `let` (não `const`) de propósito: o teste do achado 2 troca o catálogo
// para ter uma categoria para filtrar, e o teste de "zero resultados"
// precisa do catálogo VAZIO — CartView não usa `products` (só
// `getFreeShippingEligibleProducts`, mocado à parte abaixo), então mudar
// isto não afeta os testes do carrinho. Resetado no beforeEach do describe
// da SearchView.
let mockedProducts: Product[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: mockedProducts,
    getFreeShippingEligibleProducts: () => [],
  }),
}));

// Dublê com estado real: cada teste começa com um item no carrinho, e
// clearCart/removeFromCart mudam esse estado de verdade — a árvore
// renderizada reage, como reagiria com o CartContext de produção.
vi.mock("@/hooks/useCart", () => ({
  useCart: () => {
    const [cart, setCart] = useState<CartItem[]>([itemNoCarrinho]);
    const clearCart = useCallback(() => setCart([]), []);
    const removeFromCart = useCallback(
      (productId: string, variantId?: string) => {
        setCart((prev) =>
          prev.filter(
            (i) =>
              !(
                i.product.id === productId &&
                (i.variantId ?? "") === (variantId ?? "")
              ),
          ),
        );
      },
      [],
    );
    return {
      cart,
      shippingFee: 10,
      updateQuantity: vi.fn(),
      removeFromCart,
      clearCart,
      selectedShippingOption: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// O botão real vive dentro de CartItemsList (CartItemsList.tsx:203-208), que
// arrasta framer-motion e drag handlers que não interessam a este teste. O
// dublê preserva o único fio que importa: o handler que o CartView passou.
vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: ({ handleClearCart }: { handleClearCart: () => void }) => (
    <div data-testid="itens">
      <button onClick={handleClearCart}>Limpar Tudo</button>
    </div>
  ),
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// SearchView: catálogo vazio garante zero resultados independente do debounce
// interno de useSearch — o que se testa aqui é se o TERMO some da caixa, não
// o algoritmo de filtragem (já coberto em outro lugar).
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// O painel "Refinar Busca" (achado 2) vive dentro de um Sheet — mesmo padrão
// de painel-avisa-pedido-pago-e-cancelado.test.tsx: o Radix real de
// Dialog/Sheet depende de PointerEvent/ResizeObserver que o jsdom deste
// projeto não implementa. O dublê preserva o CONTRATO (open/onOpenChange no
// Sheet, SheetTrigger abre, SheetContent só existe quando aberto) sem
// depender do Radix — e sem Portal, então o painel aparece na própria árvore
// renderizada, achável por hospedeiro.querySelectorAll como o resto.
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
  SheetTrigger: ({
    children,
  }: {
    asChild?: boolean;
    children: ReactNode;
  }) => {
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
  // O CartView também usa a folha (seletor de endereço, 22/09): as peças
  // dele precisam existir no dublê, mesmo fechadas.
  SheetDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx e cart-view-promessas-que-a-loja-nao-cumpre.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchView — acessibilidade e alvos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockedProducts = [produtoVestido];
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="vestido"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const botoes = () => [...hospedeiro.querySelectorAll("button")];

  it("Voltar tem 44 px e a contagem de resultados é anunciada (role=status)", () => {
    const voltar = hospedeiro.querySelector('button[aria-label="Voltar"]');
    expect(voltar?.className).toContain("size-11");
    const status = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (e) => /resultado/.test(e.textContent ?? ""),
    );
    expect(status).toBeDefined();
  });

  it("as pílulas de categoria dizem qual está marcada e têm alvo de 44 px", () => {
    const pilulas = botoes().filter(
      (b) => b.getAttribute("aria-pressed") !== null,
    );
    expect(pilulas.length).toBeGreaterThan(0);
    const marcadas = pilulas.filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(marcadas.map((b) => b.textContent?.trim())).toContain("Todas");
    for (const b of pilulas) expect(b.className).toContain("min-h-11");
    const filtros = botoes().find((b) => b.textContent?.startsWith("Filtros"));
    expect(filtros?.className).toContain("min-h-11");
  });

  it("no painel Refinar Busca, ordenação e categoria também dizem o estado", async () => {
    const filtros = botoes().find((b) => b.textContent?.startsWith("Filtros"));
    await act(async () => {
      filtros!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menorPreco = botoes().find((b) => b.textContent === "Menor Preço");
    expect(menorPreco?.getAttribute("aria-pressed")).toBe("false");
    expect(menorPreco?.className).toContain("min-h-11");
    await act(async () => {
      menorPreco!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const depois = botoes().find((b) => b.textContent === "Menor Preço");
    expect(depois?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      botoes()
        .find((b) => b.textContent === "Vestidos")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // "Limpar Tudo" do painel aparece com filtro ativo e tem alvo de 44 px
    const limpar = botoes().find((b) => b.textContent === "Limpar Tudo");
    expect(limpar?.className).toContain("min-h-11");
  });
});
