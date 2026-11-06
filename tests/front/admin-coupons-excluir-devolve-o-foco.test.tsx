// @vitest-environment jsdom
//
// Excluir um cupom só com o teclado: o botão da lixeira some junto com o cartão
// e o foco caía no corpo da página (quem usa teclado ou leitor de tela voltava
// ao início). Agora, depois de EXCLUIR, o foco vai para o título da tela; em
// "Cancelar" o cartão continua lá e o foco volta para a lixeira de onde saiu.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const deleteCoupon = vi.fn(async (id: string) => {
  mockCoupons = mockCoupons.filter((c) => c.id !== id);
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon,
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

function cupom(id: string, code: string): Coupon {
  return {
    id,
    code,
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
  };
}

const esperar = () => new Promise<void>((r) => setTimeout(r, 30));

describe("AdminCouponsView — o foco depois de excluir", () => {
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
    mockCoupons = [cupom("c1", "PRIMEIRO"), cupom("c2", "SEGUNDO")];
    deleteCoupon.mockClear();
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

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  async function pedirExclusao(codigo: string) {
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="Excluir cupom ${codigo}"]`,
    );
    expect(lixeira).not.toBeNull();
    lixeira?.focus();
    await act(async () => {
      lixeira?.click();
      await esperar();
    });
    return lixeira as HTMLButtonElement;
  }

  function botaoDaPergunta(texto: string) {
    return [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
  }

  it("excluiu: o foco vai para o título da tela, não para o corpo da página", async () => {
    await abrirTela();
    await pedirExclusao("PRIMEIRO");
    await act(async () => {
      botaoDaPergunta("Excluir cupom")?.click();
      await esperar();
    });
    await act(async () => {
      await esperar();
    });

    expect(deleteCoupon).toHaveBeenCalledWith("c1");
    expect(
      hospedeiro.querySelector('button[aria-label="Excluir cupom PRIMEIRO"]'),
    ).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(hospedeiro.querySelector("h1")),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("cancelou: o foco volta para a lixeira de onde saiu", async () => {
    await abrirTela();
    const lixeira = await pedirExclusao("PRIMEIRO");
    await act(async () => {
      botaoDaPergunta("Cancelar")?.click();
      await esperar();
    });

    expect(deleteCoupon).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(lixeira));
  });
});
