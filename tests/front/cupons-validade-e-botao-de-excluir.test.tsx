// @vitest-environment jsdom
//
// Lista de cupons:
//  - cupom SEM validade diz "Sem validade" (antes aparecia "Aproveitamento",
//    palavra que não é uma validade e some do lugar onde a lojista procura a data);
//  - o botão que EXCLUI de verdade na confirmação é claramente destrutivo
//    (vermelho), diferente do "Cancelar", e o foco abre no lado seguro.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
// O hook devolve "está offline": false = com internet.
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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

let mockCoupons: Coupon[] = [];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const cupom = (extra: Partial<Coupon>): Coupon => ({
  id: "cupom-1",
  code: "NATAL2026",
  type: "percentage",
  value: 10,
  usageCount: 0,
  active: true,
  ...extra,
});

describe("Cupons: validade e exclusão", () => {
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockCoupons = [];
  });

  async function abrir() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active onNavigate={vi.fn()} />);
    });
  }

  it("sem validade, o cartão diz 'Sem validade' e não 'Aproveitamento'", async () => {
    mockCoupons = [cupom({})];
    await abrir();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Sem validade");
    expect(texto).not.toContain("Aproveitamento");
    expect(texto).not.toContain("Expira em:");
  });

  it("com validade, continua mostrando a data", async () => {
    mockCoupons = [cupom({ validUntil: "2099-12-31T12:00:00Z" })];
    await abrir();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Expira em:");
    expect(texto).not.toContain("Sem validade");
  });

  it("na confirmação, 'Excluir cupom' é vermelho e diferente de 'Cancelar'; o foco abre em 'Cancelar'", async () => {
    mockCoupons = [cupom({})];
    await abrir();
    const lixeira = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.querySelector('svg[class*="lucide-trash"]'),
    );
    await act(async () => lixeira?.click());

    const botoes = [...document.body.querySelectorAll("button")];
    const excluir = botoes.find(
      (b) => b.textContent?.trim() === "Excluir cupom",
    );
    const cancelar = botoes.find((b) => b.textContent?.trim() === "Cancelar");
    expect(excluir).toBeTruthy();
    expect(cancelar).toBeTruthy();
    expect(excluir?.className).toContain("text-red-");
    expect(excluir?.className).toContain("bg-red-");
    expect(excluir?.className).toContain("border-solid");
    expect(cancelar?.className).not.toContain("red");
    expect(excluir?.className).not.toBe(cancelar?.className);
    expect(document.activeElement).toBe(cancelar);
    expect(document.body.textContent).toContain("Excluir cupom?");
  });
});
