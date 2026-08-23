// @vitest-environment jsdom
//
// "Limpar Tudo" prometia limpar e não limpava — na mesma família de defeito,
// em dois lugares diferentes:
//
//   - CartView.tsx: handleClearCart chamava onRemove("all"), que é
//     removeFromCart("all") do CartContext. Nenhum item tem product.id
//     "all", então nada saía do carrinho; o location.reload() só escondia
//     isso por um instante, e o sessionStorage.clear() ainda apagava
//     guest_tracked_orders — o rastreio da cliente SEM CONTA.
//   - SearchView.tsx: handleClearFilters resetava categoria, preço mínimo,
//     preço máximo e ordenação, mas nunca o termo digitado. Com um termo
//     sem resultado e nenhum filtro ativo, o botão "Limpar Tudo" da tela de
//     "Ué, nenhum resultado?" era inerte.
//
// POR QUE RENDER DE VERDADE, E POR QUE OS DUBLÊS: CartItemsList é
// substituído por um botão simples que chama exatamente o `handleClearCart`
// que o CartView passou — mantém o teste medindo a lógica do CartView (não
// o drag-and-drop de CartItemsList), do mesmo jeito que o teste-irmão
// cart-view-promessas-que-a-loja-nao-cumpre.test.tsx já faz para os outros
// subcomponentes. useCart é um dublê COM ESTADO real (useState/useCallback),
// não um vi.fn() espionado: a asserção é sobre o CARRINHO FICAR VAZIO na
// árvore renderizada (EmptyCart aparece), nunca sobre "a função foi
// chamada" — é essa a diferença que prova o efeito, não a intenção.
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
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx e cart-view-promessas-que-a-loja-nao-cumpre.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — Limpar Tudo limpa de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    sessionStorage.setItem(
      "guest_tracked_orders",
      JSON.stringify([{ id: "pedido-convidado-1" }]),
    );
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    confirmSpy?.mockRestore();
    sessionStorage.clear();
  });

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro;
  }

  async function clicarLimparTudo(hospedeiro: HTMLDivElement) {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Limpar Tudo",
    );
    if (!botao)
      throw new Error('Botão "Limpar Tudo" não encontrado no carrinho');
    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("com itens no carrinho, confirmar Limpar Tudo esvazia o carrinho de verdade", async () => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const host = await renderizarCarrinho();

    // A âncora: o item aparece antes de limpar.
    expect(host.querySelector('[data-testid="itens"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="carrinho-vazio"]')).toBeNull();

    await clicarLimparTudo(host);

    expect(host.querySelector('[data-testid="carrinho-vazio"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="itens"]')).toBeNull();
  });

  it("o rastreio de convidado sobrevive a Limpar Tudo", async () => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const host = await renderizarCarrinho();

    await clicarLimparTudo(host);

    expect(sessionStorage.getItem("guest_tracked_orders")).toBe(
      JSON.stringify([{ id: "pedido-convidado-1" }]),
    );
  });

  it("controle negativo: cancelar a confirmação mantém o carrinho intacto", async () => {
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const host = await renderizarCarrinho();

    await clicarLimparTudo(host);

    // Sem confirmação, nada deveria ter sido apagado — prova que o efeito
    // medido no primeiro teste vem da confirmação, não de um clique cru.
    expect(host.querySelector('[data-testid="carrinho-vazio"]')).toBeNull();
    expect(host.querySelector('[data-testid="itens"]')).not.toBeNull();
  });
});

describe("SearchView — Limpar Tudo limpa a busca de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockedProducts = [];
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("com termo digitado e zero resultados, Limpar Tudo tira o termo da caixa", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="brinco dourado"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const input = hospedeiro.querySelector<HTMLInputElement>("#search-input");
    if (!input) throw new Error("Caixa de busca não encontrada");
    expect(input.value).toBe("brinco dourado");
    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Limpar Tudo",
    );
    if (!botao) throw new Error('Botão "Limpar Tudo" não encontrado na busca');

    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(input.value).toBe("");
  });

  // Achado 1 da revisão: SearchView só limpava a CÓPIA LOCAL do termo.
  // A barra de busca do Header (fora desta árvore) tem a dela própria, e só
  // sabe que o termo sumiu se o SearchView avisar — por isso o teste mede a
  // CHAMADA do callback, não a caixa (já coberto pelo teste anterior).
  it("com termo digitado e zero resultados, Limpar Tudo avisa o pai para limpar a busca também", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    const onQueryChange = vi.fn();
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="brinco dourado"
          onQueryChange={onQueryChange}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Limpar Tudo",
    );
    if (!botao) throw new Error('Botão "Limpar Tudo" não encontrado na busca');

    expect(onQueryChange).not.toHaveBeenCalled();

    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  // Achado 2 da revisão, e o mais importante: handleClearFilters virou o
  // handler dos DOIS botões "Limpar Tudo" — o do estado vazio (alvo do
  // commit a015e8a) e o do painel "Refinar Busca", cujo trabalho SEMPRE foi
  // só resetar filtro, preservando o termo. Este teste é o controle que
  // impede essa regressão de voltar: filtra por categoria, limpa pelo
  // painel, e o termo tem que continuar na caixa.
  it("o 'Limpar Tudo' do painel Refinar Busca reseta os filtros e preserva o termo digitado", async () => {
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

    const input = hospedeiro.querySelector<HTMLInputElement>("#search-input");
    if (!input) throw new Error("Caixa de busca não encontrada");
    expect(input.value).toBe("vestido");
    // Confirma que NÃO é o estado vazio (senão o "Limpar Tudo" achado seria
    // o do commit a015e8a, não o do painel — os dois têm o mesmo texto).
    expect(hospedeiro.textContent).not.toContain("Ué, nenhum resultado?");

    const botaoFiltros = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.startsWith("Filtros"),
    );
    if (!botaoFiltros) throw new Error('Botão "Filtros" não encontrado');
    await act(async () => {
      botaoFiltros.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const botaoCategoria = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) => b.textContent === "Vestidos");
    if (!botaoCategoria) throw new Error('Categoria "Vestidos" não encontrada');
    await act(async () => {
      botaoCategoria.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Com filtro ativo, o painel revela seu próprio "Limpar Tudo" — o único
    // com esse texto nesta árvore agora, porque o de estado vazio não
    // renderiza com resultado na tela.
    const botaoLimparPainel = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) => b.textContent === "Limpar Tudo");
    if (!botaoLimparPainel)
      throw new Error('Botão "Limpar Tudo" do painel não encontrado');

    await act(async () => {
      botaoLimparPainel.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    // A regressão que este teste impede: os filtros somem, o TERMO fica.
    expect(input.value).toBe("vestido");

    // E os filtros SOMEM de verdade. Sem esta linha, apagar o corpo inteiro
    // de `handleClearFilters` passava nos seis casos: o botao do painel podia
    // virar no-op e ninguem via. O botao so e desenhado quando ha filtro
    // ativo, entao ele desaparecer E a prova de que o reset aconteceu.
    expect(
      Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent === "Limpar Tudo",
      ),
    ).toBeUndefined();
  });
});
