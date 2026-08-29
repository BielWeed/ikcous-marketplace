// @vitest-environment jsdom
//
// Auditoria do painel do lojista, achado 15 (20/08/2026) — o card do cupom
// arredondava o "Mínimo Compra" para inteiro: R$ 49,90 aparecia como
// "R$ 50", e R$ 50,40 também. `min_purchase` é `numeric` no banco e aceita
// centavos; o valor exibido é dinheiro que quem compra usa para decidir se
// bate o mínimo — arredondar para cima ou para baixo mostra um valor que
// não existe.
//
// O QUE MUDOU
//   `Number(coupon.minPurchase).toFixed(0)` virou `formatCurrency(...)`
//   (src/lib/utils.ts) — o mesmo utilitário de moeda já usado em outras
//   telas do painel, com 2 casas decimais garantidas pelo Intl.NumberFormat.
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

// Mesmo motivo de admin-coupons-view-expirado.test.tsx: o AdminKpiCarousel
// (embla-carousel-react) chama ResizeObserver/IntersectionObserver/matchMedia
// no mount, ausentes no jsdom deste projeto.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
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

describe("AdminCouponsView — o mínimo de compra mostra os centavos de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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

  function textoDoCard(codigo: string): string {
    const botaoDoCodigo = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((el) => el.textContent?.includes(codigo));
    if (!botaoDoCodigo) {
      throw new Error(`Card do cupom "${codigo}" não encontrado no DOM`);
    }
    const card = botaoDoCodigo.closest(".group");
    if (!card) {
      throw new Error(`Container do card "${codigo}" não encontrado`);
    }
    return (card.textContent ?? "").replace(/\s+/g, " ");
  }

  it("R$ 49,90 não vira R$ 50 no card", async () => {
    mockCoupons = [
      cupomFake({ id: "c-49-90", code: "QUASE50", minPurchase: 49.9 }),
    ];

    await abrirTela();

    const texto = textoDoCard("QUASE50");
    expect(texto).toContain("R$ 49,90");
    // "R$ 50" sem vírgula seria o arredondamento indevido.
    expect(texto).not.toMatch(/Mínimo Compra R\$ 50\b/);
  });

  it("R$ 50,40 também não vira R$ 50", async () => {
    mockCoupons = [
      cupomFake({ id: "c-50-40", code: "PASSADO50", minPurchase: 50.4 }),
    ];

    await abrirTela();

    const texto = textoDoCard("PASSADO50");
    expect(texto).toContain("R$ 50,40");
    expect(texto).not.toMatch(/Mínimo Compra R\$ 50\b/);
  });

  it("cupom sem mínimo continua mostrando R$ 0,00, sem quebrar", async () => {
    mockCoupons = [
      cupomFake({ id: "c-sem-minimo", code: "SEMMINIMO", minPurchase: 0 }),
    ];

    await abrirTela();

    const texto = textoDoCard("SEMMINIMO");
    expect(texto).toContain("R$ 0,00");
  });
});
