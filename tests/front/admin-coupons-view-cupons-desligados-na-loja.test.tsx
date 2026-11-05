// @vitest-environment jsdom
//
// Com a chave geral "Cupons de Desconto" DESLIGADA, o servidor recusa qualquer
// cupom ("Os cupons estão desativados nesta loja"), mas a lista seguia mostrando
// "N / total — Disponíveis para uso". Agora o indicador zera, o rodapé diz que
// os cupons estão desligados e um aviso no topo explica. O selo de cada cupom
// (a chavinha DELE) não muda, e nada é apagado.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
let mockConfig: { enableCoupons: boolean } = { enableCoupons: true };
let mockConfigCarregada = true;

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
    config: mockConfig,
    isLoaded: mockConfigCarregada,
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

const AVISO = "Cupons desligados na loja — nenhum cupom pode ser usado agora.";

describe("AdminCouponsView — cupons desligados na loja", () => {
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
    mockCoupons = [
      cupom({ id: "a", code: "UM" }),
      cupom({ id: "b", code: "DOIS", value: 20 }),
    ];
    mockConfig = { enableCoupons: true };
    mockConfigCarregada = true;
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
  });

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  it("desligados: aviso no topo, indicador zerado e rodapé honesto", async () => {
    mockConfig = { enableCoupons: false };
    await abrirTela();
    expect(texto()).toContain(AVISO);
    expect(texto()).toMatch(/Cupons Ativos\s*0\s*\/\s*2/);
  });

  it("desligados: o rodapé das métricas abertas não promete 'Disponíveis para uso'", async () => {
    mockConfig = { enableCoupons: false };
    await abrirTela();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-controls="coupon-metrics"]')
        ?.click();
    });
    expect(texto()).toContain("Desligados na loja");
    expect(texto()).not.toContain("Disponíveis para uso");
  });

  it("controle: ligados, as métricas abertas seguem com 'Disponíveis para uso'", async () => {
    await abrirTela();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-controls="coupon-metrics"]')
        ?.click();
    });
    expect(texto()).toContain("Disponíveis para uso");
  });

  it("desligados: o selo de cada cupom continua sendo o da chavinha dele", async () => {
    mockConfig = { enableCoupons: false };
    await abrirTela();
    expect(texto()).toContain("UM");
    expect(texto()).toContain("DOIS");
    expect(texto().match(/Ativo/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("controle: ligados, sem aviso e com a contagem de sempre", async () => {
    await abrirTela();
    expect(texto()).not.toContain(AVISO);
    expect(texto()).toMatch(/Cupons Ativos\s*2\s*\/\s*2/);
  });

  it("configuração ainda não carregou: não afirma que está desligado", async () => {
    mockConfig = { enableCoupons: false };
    mockConfigCarregada = false;
    await abrirTela();
    expect(texto()).not.toContain(AVISO);
    expect(texto()).toMatch(/Cupons Ativos\s*2\s*\/\s*2/);
  });
});
