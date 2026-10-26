// @vitest-environment jsdom
//
// "Desconto Médio" entrava com TODO cupom em porcentagem, inclusive o vencido,
// o desligado e o esgotado, enquanto "Cupons Ativos" (ao lado) já contava só
// os que o checkout ainda aceita. A média passa a usar o mesmo critério do
// selo "Ativo" (`rotuloDoCupom`).
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cupom(overrides: Partial<Coupon>): Coupon {
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

describe("AdminCouponsView — Desconto Médio só dos cupons ativos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
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

  function descontoMedio(): string {
    const texto = (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
    const achou = /Desconto Médio\s*(\d+)%/.exec(texto);
    if (!achou) throw new Error(`Desconto Médio não encontrado em: ${texto}`);
    return `${achou[1]}%`;
  }

  it("vencido e desligado não entram na média: só o cupom ativo conta", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "ATIVO10", value: 10 }),
      cupom({ id: "b", code: "VENCIDO50", value: 50, validUntil: noPassado() }),
      cupom({ id: "c", code: "DESLIGADO30", value: 30, active: false }),
    ];
    await abrirTela();
    expect(descontoMedio()).toBe("10%");
  });

  it("esgotado (usos no teto) também fica de fora", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "ATIVO20", value: 20 }),
      cupom({
        id: "b",
        code: "ESGOTADO60",
        value: 60,
        usageLimit: 5,
        usageCount: 5,
      }),
    ];
    await abrirTela();
    expect(descontoMedio()).toBe("20%");
  });

  it("controle: com dois ativos a média continua sendo a dos dois", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "ATIVO10", value: 10 }),
      cupom({ id: "b", code: "ATIVO20", value: 20 }),
    ];
    await abrirTela();
    expect(descontoMedio()).toBe("15%");
  });

  it("sem nenhum cupom ativo a média é 0%", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "VENCIDO50", value: 50, validUntil: noPassado() }),
    ];
    await abrirTela();
    expect(descontoMedio()).toBe("0%");
  });
});
