// @vitest-environment jsdom
//
// A aba "Meus Pedidos" da convidada entrega o WhatsApp da loja ao rastreio
// (OrderSearch), que o usa no aviso "Comprou sem criar conta?". Sem esta
// fiação o aviso nasceria sem botão mesmo com a loja atendendo por WhatsApp.
//
// OrderSearch é dublado (mostra a prop recebida): o comportamento do aviso em
// si está em order-search-diz-a-quem-comprou-sem-conta-o-que-fazer.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let whatsappDaLoja: string | undefined = "34999998888";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: 0,
      whatsappNumber: whatsappDaLoja,
    },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: vi.fn().mockResolvedValue([]),
    orders: [],
  }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: (props: { whatsappDaLoja?: string | null }) => (
    <div data-testid="busca-pedido">
      whatsapp-recebido:[{props.whatsappDaLoja ?? "nenhum"}]
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de CartView.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — aba Meus Pedidos da convidada leva o WhatsApp da loja ao rastreio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    whatsappDaLoja = "34999998888";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrirMeusPedidos() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("loja com WhatsApp: o rastreio recebe o número", async () => {
    const texto = await abrirMeusPedidos();
    // Âncora: o rastreio montou (sem ela a ausência/presença não prova nada).
    expect(
      hospedeiro.querySelector('[data-testid="busca-pedido"]'),
    ).not.toBeNull();
    expect(texto).toContain("whatsapp-recebido:[34999998888]");
  });

  it("loja sem WhatsApp: o rastreio recebe nada (vira instrução, não botão)", async () => {
    whatsappDaLoja = undefined;
    const texto = await abrirMeusPedidos();
    expect(
      hospedeiro.querySelector('[data-testid="busca-pedido"]'),
    ).not.toBeNull();
    expect(texto).toContain("whatsapp-recebido:[nenhum]");
  });
});
