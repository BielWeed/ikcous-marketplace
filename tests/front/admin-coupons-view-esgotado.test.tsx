// @vitest-environment jsdom
//
// Cupom ESGOTADO (usos no teto) continuava com o selo verde "Ativo" e contado
// em "Cupons Ativos — Disponíveis para uso", mesmo o checkout já recusando
// ("Cupom atingiu o limite de uso"). `status-do-cupom.test.ts` prova a regra
// pura; este arquivo prova que a TELA a liga ao selo e ao indicador.
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

describe("AdminCouponsView — cupom esgotado para de dizer Ativo", () => {
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
    return card.textContent ?? "";
  }

  /** O número que o indicador "Cupons Ativos" mostra. */
  function numeroDosAtivos(): string {
    const textoGeral = hospedeiro.textContent ?? "";
    const posicao = textoGeral.indexOf("Cupons Ativos");
    expect(posicao).toBeGreaterThan(-1);
    return /^Cupons Ativos\s*(\d+)/.exec(textoGeral.slice(posicao))?.[1] ?? "";
  }

  it("cupom com os usos no teto mostra Esgotado, não Ativo", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-esgotado",
        code: "ACABOU",
        usageLimit: 3,
        usageCount: 3,
      }),
    ];
    await abrirTela();
    const texto = textoDoCard("ACABOU");
    expect(texto).toContain("Esgotado");
    expect(texto).not.toContain("Ativo");
  });

  it("cupom com usos abaixo do teto segue Ativo", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-sobra",
        code: "SOBROU",
        usageLimit: 3,
        usageCount: 2,
      }),
    ];
    await abrirTela();
    const texto = textoDoCard("SOBROU");
    expect(texto).toContain("Ativo");
    expect(texto).not.toContain("Esgotado");
  });

  it("cupom ilimitado (limite 0 ou ausente) nunca esgota, por mais que tenha sido usado", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-zero",
        code: "LIMITEZERO",
        usageLimit: 0,
        usageCount: 80,
      }),
      cupomFake({ id: "c-sem", code: "SEMLIMITE", usageCount: 80 }),
    ];
    await abrirTela();
    expect(textoDoCard("LIMITEZERO")).not.toContain("Esgotado");
    expect(textoDoCard("SEMLIMITE")).not.toContain("Esgotado");
  });

  it("cupom desligado e esgotado mostra Inativo (a chavinha decide)", async () => {
    mockCoupons = [
      cupomFake({
        id: "c-off",
        code: "DESLIGADOESGOTADO",
        active: false,
        usageLimit: 1,
        usageCount: 1,
      }),
    ];
    await abrirTela();
    const texto = textoDoCard("DESLIGADOESGOTADO");
    expect(texto).toContain("Inativo");
    expect(texto).not.toContain("Esgotado");
  });

  it("o indicador 'Cupons Ativos — Disponíveis para uso' não conta o cupom esgotado", async () => {
    mockCoupons = [
      cupomFake({
        id: "c1",
        code: "UMDISPONIVEL",
        usageLimit: 5,
        usageCount: 1,
      }),
      cupomFake({
        id: "c2",
        code: "UMILIMITADO",
        usageLimit: 0,
        usageCount: 40,
      }),
      cupomFake({
        id: "c3",
        code: "ESGOTADOUM",
        usageLimit: 2,
        usageCount: 2,
      }),
      cupomFake({
        id: "c4",
        code: "ESGOTADODOIS",
        usageLimit: 1,
        usageCount: 4,
      }),
    ];
    await abrirTela();
    expect(numeroDosAtivos()).toBe("2");
    expect(hospedeiro.textContent).toContain("/ 4 total");
  });
});
