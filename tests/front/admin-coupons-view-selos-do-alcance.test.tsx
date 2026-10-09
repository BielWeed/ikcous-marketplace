// @vitest-environment jsdom
//
// Frente B (cupons visíveis no checkout): a lista de cupons do painel mostra,
// em cada cartão, QUEM vê o cupom no checkout.
//   - "todos os clientes" (vitrine)   -> selo "No checkout"
//   - "clientes escolhidos"           -> selo "Exclusivo"
//   - "quem tiver o código" (secreto) -> nenhum selo (é o cupom de sempre)
//
// A borda que importa: cupom lido de um banco SEM a coluna `alcance` (lojas de
// teste, que recebem só o site) chega sem o campo — tem de ficar sem selo, e
// nunca com um selo inventado.
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

// Dublês que o carrossel de KPIs (embla) exige e o jsdom não tem — mesmo
// padrão de admin-coupons-view-expirado.test.tsx.
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

describe("AdminCouponsView — selos de quem vê o cupom no checkout", () => {
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

  /** Texto só do cartão do cupom (a raiz do cartão tem a classe `group`). */
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

  it("cupom de todos os clientes (vitrine) mostra 'No checkout' e não 'Exclusivo'", async () => {
    mockCoupons = [cupomFake({ code: "PARATODOS", alcance: "vitrine" })];
    await abrirTela();
    const texto = textoDoCard("PARATODOS");
    expect(texto).toContain("No checkout");
    expect(texto).not.toContain("Exclusivo");
  });

  it("cupom de clientes escolhidos mostra 'Exclusivo' e não 'No checkout'", async () => {
    mockCoupons = [cupomFake({ code: "SOVIP", alcance: "exclusivo" })];
    await abrirTela();
    const texto = textoDoCard("SOVIP");
    expect(texto).toContain("Exclusivo");
    expect(texto).not.toContain("No checkout");
  });

  it("cupom secreto (quem tiver o código) não ganha selo nenhum", async () => {
    mockCoupons = [cupomFake({ code: "SEGREDO", alcance: "codigo" })];
    await abrirTela();
    const texto = textoDoCard("SEGREDO");
    expect(texto).not.toContain("No checkout");
    expect(texto).not.toContain("Exclusivo");
  });

  it("cupom vindo de banco sem a coluna alcance (campo ausente) não ganha selo", async () => {
    mockCoupons = [cupomFake({ code: "BANCOVELHO" })];
    expect("alcance" in mockCoupons[0]).toBe(false);
    await abrirTela();
    const texto = textoDoCard("BANCOVELHO");
    expect(texto).not.toContain("No checkout");
    expect(texto).not.toContain("Exclusivo");
  });

  it("cada cartão leva o SEU selo quando há os três tipos na lista", async () => {
    mockCoupons = [
      cupomFake({ id: "a", code: "AAATODOS", alcance: "vitrine" }),
      cupomFake({ id: "b", code: "BBBVIP", alcance: "exclusivo" }),
      cupomFake({ id: "c", code: "CCCSECRETO", alcance: "codigo" }),
    ];
    await abrirTela();
    expect(textoDoCard("AAATODOS")).toContain("No checkout");
    expect(textoDoCard("BBBVIP")).toContain("Exclusivo");
    expect(textoDoCard("CCCSECRETO")).not.toMatch(/No checkout|Exclusivo/);
  });

  it("o selo não troca o rótulo do tipo de desconto nem o estado do cupom", async () => {
    mockCoupons = [
      cupomFake({ code: "COMSELO", alcance: "exclusivo", type: "fixed" }),
    ];
    await abrirTela();
    const texto = textoDoCard("COMSELO");
    expect(texto).toContain("Desconto Fixo");
    expect(texto).toContain("Ativo");
  });
});
