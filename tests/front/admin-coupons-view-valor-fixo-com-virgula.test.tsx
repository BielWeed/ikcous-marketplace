// @vitest-environment jsdom
//
// Painel do lojista — o card do cupom de VALOR FIXO mostrava o desconto com
// PONTO ("R$ 10.00"), enquanto o "Mínimo Compra" ao lado já saía com vírgula
// ("R$ 50,00"). O lojista lia a mesma tela em dois formatos de dinheiro.
//
// O QUE MUDOU: o desconto passou a usar `formatCurrency` (src/lib/utils.ts), o
// mesmo utilitário de moeda do "Mínimo Compra" e do resto do painel, no lugar
// de montar o texto com `Number(x).toFixed(2)`.
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

describe("AdminCouponsView — o desconto de valor fixo usa vírgula, como o resto do painel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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

  it("cupom de R$ 10 de desconto aparece como R$ 10,00, nunca R$ 10.00", async () => {
    mockCoupons = [
      cupomFake({ id: "c-10", code: "DEZREAIS", value: 10, minPurchase: 50 }),
    ];

    await abrirTela();

    const texto = textoDoCard("DEZREAIS");
    expect(texto).toMatch(/Desconto\s*R\$ 10,00/);
    expect(texto).toContain("R$ 50,00");
    expect(texto).not.toContain("10.00");
  });

  it("centavos no desconto também saem com vírgula (R$ 7,50)", async () => {
    mockCoupons = [cupomFake({ id: "c-7-5", code: "SETEMEIO", value: 7.5 })];

    await abrirTela();

    const texto = textoDoCard("SETEMEIO");
    expect(texto).toContain("R$ 7,50");
    expect(texto).not.toContain("7.50");
  });

  it("cupom em porcentagem continua mostrando 10% OFF", async () => {
    mockCoupons = [
      cupomFake({ id: "c-pct", code: "DEZPORCENTO", type: "percentage" }),
    ];

    await abrirTela();

    expect(textoDoCard("DEZPORCENTO")).toContain("10% OFF");
  });
});
