// @vitest-environment jsdom
//
// Cupom com limite de 1 uso mostrava "0 / 1 usos" no cartão e em
// "Aproveitamento". A palavra concorda com o limite que vem depois da barra:
// "0 / 1 uso", mas "1 / 10 usos" e "3 / ∞ usos".
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

describe("AdminCouponsView — 'uso' concorda com o limite", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockCoupons = [];
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  async function abrirDetalhes() {
    const detalhes = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Detalhes",
    );
    if (!detalhes) throw new Error("Botão Detalhes não encontrado");
    await act(async () => detalhes.click());
  }

  it("limite de 1 uso: '0 / 1 uso' no cartão e no Aproveitamento", async () => {
    mockCoupons = [cupomFake({ usageLimit: 1, usageCount: 0 })];
    await abrirTela();
    expect(hospedeiro.textContent).toContain("0 / 1 uso");
    expect(hospedeiro.textContent).not.toContain("1 usos");
    await abrirDetalhes();
    expect(hospedeiro.textContent).toContain("Aproveitamento · 0 / 1 uso");
    expect(hospedeiro.textContent).not.toContain("1 usos");
  });

  it("limite maior que 1 ou sem limite segue no plural", async () => {
    mockCoupons = [
      cupomFake({ id: "a", code: "AAA", usageLimit: 10, usageCount: 1 }),
      cupomFake({ id: "b", code: "BBB", usageLimit: undefined, usageCount: 3 }),
    ];
    await abrirTela();
    expect(hospedeiro.textContent).toContain("1 / 10 usos");
    expect(hospedeiro.textContent).toContain("3 / ∞ usos");
  });
});
