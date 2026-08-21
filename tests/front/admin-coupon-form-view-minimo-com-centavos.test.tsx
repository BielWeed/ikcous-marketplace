// @vitest-environment jsdom
//
// Auditoria do painel do lojista, achado 15 (20/08/2026) — a pré-visualização
// do formulário de cupom tinha o MESMO defeito do card em AdminCouponsView:
// `Number(formData.minPurchase || 0).toFixed(0)` arredondava o mínimo de
// compra para inteiro. Ver
// tests/front/admin-coupons-view-minimo-com-centavos.test.tsx para o card.
//
// O QUE MUDOU: a pré-visualização passou a usar `formatCurrency` (mesmo
// utilitário do card, `src/lib/utils.ts`), em vez de escrever `toFixed` de
// novo.
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
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

describe("AdminCouponFormView — a pré-visualização mostra os centavos do mínimo", () => {
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
  }

  it("R$ 49,90 não vira R$ 50 na pré-visualização, ao editar um cupom existente", async () => {
    mockCoupons = [
      cupomFake({ id: "c-49-90", code: "QUASE50", minPurchase: 49.9 }),
    ];

    await abrirTela("c-49-90");

    expect(texto()).toContain("R$ 49,90");
    expect(texto()).not.toMatch(/Mínimo Compra R\$ 50\b/);
  });

  it("cupom novo, sem mínimo preenchido, mostra R$ 0,00 na pré-visualização", async () => {
    await abrirTela();

    expect(texto()).toContain("R$ 0,00");
  });
});
