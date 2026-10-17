// @vitest-environment jsdom
//
// Painel do lojista — a pré-visualização do formulário de cupom de VALOR FIXO
// mostrava o desconto com PONTO ("R$ 10.00") ao lado do "Mínimo Compra" já com
// vírgula ("R$ 50,00"). Mesmo defeito do card em AdminCouponsView (ver
// tests/front/admin-coupons-view-valor-fixo-com-virgula.test.tsx).
//
// O QUE MUDOU: a pré-visualização passou a usar `formatCurrency`
// (src/lib/utils.ts), em vez de montar o texto com `toFixed(2)`.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    addCoupon: vi.fn(),
    updateCoupon: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
// O formulário lê as formas de pagamento da loja (aviso do cupom que cobre a
// compra inteira): sem provedor de loja nos testes, o dublê entra aqui.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cupomFake(overrides: Partial<Coupon>): Coupon {
  return {
    id: "cupom-1",
    code: "CODIGO",
    type: "fixed",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

describe("AdminCouponFormView — a pré-visualização do valor fixo usa vírgula", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    mockCoupons = [];
  });

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  async function abrirTela(couponId?: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={couponId} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-controls="coupon-preview"]')
        ?.click();
    });
  }

  it("cupom de R$ 10 de desconto aparece como R$ 10,00 na pré-visualização", async () => {
    mockCoupons = [
      cupomFake({ id: "c-10", code: "DEZREAIS", value: 10, minPurchase: 50 }),
    ];

    await abrirTela("c-10");

    expect(texto()).toMatch(/Desconto\s*R\$ 10,00/);
    expect(texto()).toContain("R$ 50,00");
    expect(texto()).not.toContain("10.00");
  });

  it("centavos no desconto também saem com vírgula (R$ 7,50)", async () => {
    mockCoupons = [cupomFake({ id: "c-7-5", code: "SETEMEIO", value: 7.5 })];

    await abrirTela("c-7-5");

    expect(texto()).toContain("R$ 7,50");
    expect(texto()).not.toContain("7.50");
  });
});
