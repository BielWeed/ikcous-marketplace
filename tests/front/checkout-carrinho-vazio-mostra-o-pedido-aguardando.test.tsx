// @vitest-environment jsdom
//
// Lote 569 (28/11/2026): a cliente finaliza no Pix (o carrinho é esvaziado na
// criação do pedido), sai para o app do banco e volta direto ao checkout — o
// link, o app reaberto em /checkout, o Voltar. O checkout vazio dizia só "Seu
// carrinho está vazio" e mandava ao carrinho: nada do pedido que ainda espera
// pagamento. O Início e o carrinho vazio já mostravam o aviso
// (inicio-e-carrinho-vazio-mostram-o-pedido-aguardando.test.tsx); aqui só a
// ligação no checkout vazio. O comportamento do aviso (prazo, releitura, pago
// que some) mora em inicio-avisa-pedido-aguardando-pagamento.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "11111111-2222-3333-4444-5555550abc12";

const h = vi.hoisted(() => ({
  usuario: { id: "conta-1" } as null | { id: string },
  tabelas: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario, profile: null, loading: false }),
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
        consulta.maybeSingle = () =>
          Promise.resolve({ data: null, error: null });
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
    },
  };
});

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: "34999998888",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      isLoading: false,
      carrinhoSalvoNaoLido: false,
      relerCarrinhoSalvo: () => Promise.resolve(),
      cartTotal: 0,
      shippingFee: 0,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

describe("checkout com o carrinho vazio mostra o pedido aguardando pagamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    h.usuario = { id: "conta-1" };
    h.tabelas.length = 0;
    onNavigate.mockReset();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
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

  async function renderizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={onNavigate} onSetBackOverride={() => {}} />,
      );
    });
  }

  it("cliente logada: o aviso aparece junto do 'Seu carrinho está vazio' e 'Ver e pagar' abre o pedido", async () => {
    await renderizar();
    await esperarAte(() => botaoVerEPagar() !== undefined);

    expect(hospedeiro.textContent).toContain("Seu carrinho está vazio");
    expect(hospedeiro.textContent).toContain(
      "Você tem um pedido aguardando pagamento",
    );
    act(() => {
      botaoVerEPagar()?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("order-details", ID);
  });

  it("visitante: nenhuma leitura de pedidos e nenhum aviso", async () => {
    h.usuario = null;
    await renderizar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(hospedeiro.textContent).toContain("Seu carrinho está vazio");
    expect(h.tabelas).not.toContain("marketplace_orders");
    expect(hospedeiro.textContent).not.toContain("aguardando pagamento");
  });
});
