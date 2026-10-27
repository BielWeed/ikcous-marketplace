// @vitest-environment jsdom
//
// Lote 222 (M7): a caixa "Cupom indisponível" dita o que houve (expirou ou
// esgotou) em português simples e não fala em "chave".
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

// O carrossel de KPIs (AdminKpiCarousel) usa embla-carousel-react, que chama
// ResizeObserver, IntersectionObserver e matchMedia no mount — ausentes no
// jsdom deste projeto. Sem os dublês o carrossel estoura dentro do
// LocalErrorBoundary e os cards somem do DOM. Mesmo padrão de
// admin-customers-ticket-medio.test.tsx.
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

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const noPassado = () => new Date(Date.now() - UM_DIA_MS).toISOString();

describe("lote 222 — Cupom indisponível em português simples", () => {
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

  async function textoDosDetalhes(): Promise<string> {
    await abrirTela();
    const detalhes = hospedeiro.querySelector(
      '[aria-controls="coupon-details-cupom-1"]',
    ) as HTMLButtonElement;
    await act(async () => detalhes.click());
    return (
      hospedeiro.querySelector("#coupon-details-cupom-1")?.textContent ?? ""
    );
  }

  it("vencido: diz que expirou e manda ajustar a validade", async () => {
    mockCoupons = [cupomFake({ code: "VELHO", validUntil: noPassado() })];
    const texto = await textoDosDetalhes();
    expect(texto).toContain(
      "O cupom está ativo, mas expirou. Ajuste a validade para ele voltar a valer.",
    );
    expect(texto).not.toContain("chave");
  });

  it("no teto de usos: diz que esgotou e manda ajustar o limite", async () => {
    mockCoupons = [cupomFake({ code: "ACABOU", usageLimit: 3, usageCount: 3 })];
    const texto = await textoDosDetalhes();
    expect(texto).toContain(
      "O cupom está ativo, mas esgotou. Ajuste o limite de uso para ele voltar a valer.",
    );
    expect(texto).not.toContain("chave");
  });
});
