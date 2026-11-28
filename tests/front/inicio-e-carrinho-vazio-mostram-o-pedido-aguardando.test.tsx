// @vitest-environment jsdom
//
// 27/11/2026 — o aviso do pedido aguardando pagamento no lugar onde a cliente
// cai: o Início (o app instalado reabre em `/?source=pwa`) e o carrinho vazio
// (o carrinho foi esvaziado na criação do pedido). O comportamento do aviso
// mora em inicio-avisa-pedido-aguardando-pagamento.test.tsx; aqui só a
// ligação: as duas telas mostram o aviso para a cliente logada e o botão leva
// ao detalhe do pedido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "11111111-2222-3333-4444-5555550abc12";

const h = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  tabelas: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario }),
}));

vi.mock("@/lib/supabase", () => {
  const pendente = () => [
    {
      id: "11111111-2222-3333-4444-5555550abc12",
      total: 129.9,
      status: "pending",
      payment_status: "aguardando",
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
  ];
  return {
    supabase: {
      from: (tabela: string) => {
        h.tabelas.push(tabela);
        const consulta: Record<string, unknown> = {};
        const encadear = () => consulta;
        Object.assign(consulta, {
          select: encadear,
          eq: encadear,
          in: encadear,
          order: encadear,
          limit: encadear,
          abortSignal: encadear,
        });
        consulta.single = () => Promise.resolve({ data: null, error: null });
        // biome-ignore lint/suspicious/noThenProperty: o construtor do supabase é "thenable".
        consulta.then = (aoResolver: (valor: unknown) => unknown) =>
          Promise.resolve({
            data: tabela === "marketplace_orders" ? pendente() : [],
            error: null,
          }).then(aoResolver);
        return consulta;
      },
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0 },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));

// Carrinho vazio, sem o resto da tela.
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: () => Promise.resolve([]),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 10,
    updateQuantity: () => {},
    removeFromCart: () => {},
    selectedShippingOption: null,
    setSelectedShippingOption: () => {},
    setShippingCep: () => {},
  }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

class ObservadorDeMentira {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("o aviso do pedido aguardando aparece no Início e no carrinho vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let navegar: Mock<(view: string, id?: string) => void>;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObservadorDeMentira);
    vi.stubGlobal("ResizeObserver", ObservadorDeMentira);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    h.usuario = { id: "conta-1" };
    h.tabelas.length = 0;
    navegar = vi.fn<(view: string, id?: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function esperarAte(condicao: () => boolean) {
    for (let i = 0; i < 40; i++) {
      if (condicao()) return;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
  }

  const botaoVerEPagar = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Ver e pagar",
    );

  async function renderizarInicio() {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={[]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={navegar}
          selectedCategory="Todas"
          searchQuery=""
          sortBy="default"
          onCategoryChange={() => {}}
          onSortByChange={() => {}}
          userId={h.usuario?.id}
        />,
      );
    });
  }

  it("Início, cliente logada: mostra o aviso e 'Ver e pagar' abre o pedido", async () => {
    await renderizarInicio();
    await esperarAte(() => botaoVerEPagar() !== undefined);

    expect(hospedeiro.textContent).toContain(
      "Você tem um pedido aguardando pagamento",
    );
    act(() => {
      botaoVerEPagar()?.click();
    });
    expect(navegar).toHaveBeenCalledWith("order-details", ID);
  });

  it("Início, visitante: nenhuma leitura de pedidos e nenhum aviso", async () => {
    h.usuario = null;
    await renderizarInicio();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(h.tabelas).not.toContain("marketplace_orders");
    expect(hospedeiro.textContent).not.toContain("aguardando pagamento");
  });

  it("carrinho vazio, cliente logada: mostra o aviso acima do carrinho vazio", async () => {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={navegar} initialTab="cart" />);
    });
    await esperarAte(() => botaoVerEPagar() !== undefined);

    expect(
      hospedeiro.querySelector('[data-testid="carrinho-vazio"]'),
    ).not.toBeNull();
    act(() => {
      botaoVerEPagar()?.click();
    });
    expect(navegar).toHaveBeenCalledWith("order-details", ID);
  });
});
