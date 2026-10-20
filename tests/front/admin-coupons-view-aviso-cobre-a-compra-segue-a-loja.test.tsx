// @vitest-environment jsdom
//
// O aviso "este cupom pode cobrir a compra inteira" nos detalhes da LISTA tem de
// seguir a mesma regra do formulário: loja sem nenhuma forma "na retirada/
// entrega" (só recebe pelo app) recebe o aviso FORTE ("a cliente não consegue
// fechar"); loja com a forma ligada recebe o aviso brando. Antes de a lista
// seguir a regra, ela afirmava "a cliente fecha pagando na retirada" também
// para a loja que só recebe pelo app, o que é falso.
import {
  AVISO_CUPOM_PODE_COBRIR_A_COMPRA,
  AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP,
} from "@/lib/cupom-que-cobre-a-compra";
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
let mockFormasEntrega: unknown = ["cash"];

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
    config: {
      enableCoupons: true,
      formasPagamentoEntrega: mockFormasEntrega,
    },
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CUPOM_QUE_ZERA: Coupon = {
  id: "c-100",
  code: "BRINDE100",
  type: "percentage",
  value: 100,
  usageCount: 0,
  active: true,
};

describe("AdminCouponsView — aviso de cupom que cobre a compra segue a loja", () => {
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
    mockCoupons = [CUPOM_QUE_ZERA];
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockCoupons = [];
    mockFormasEntrega = ["cash"];
  });

  async function abrirDetalhes(): Promise<string> {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((el) =>
      el.getAttribute("aria-label")?.includes("Detalhes do cupom BRINDE100"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return hospedeiro.textContent ?? "";
  }

  it("loja que só recebe pelo app: a lista mostra o aviso forte", async () => {
    mockFormasEntrega = [];
    const texto = await abrirDetalhes();
    expect(texto).toContain(AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP);
    expect(texto).not.toContain(AVISO_CUPOM_PODE_COBRIR_A_COMPRA);
  });

  it("loja com pagamento na retirada ligado: a lista mostra o aviso brando", async () => {
    mockFormasEntrega = ["cash"];
    const texto = await abrirDetalhes();
    expect(texto).toContain(AVISO_CUPOM_PODE_COBRIR_A_COMPRA);
    expect(texto).not.toContain(AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP);
  });
});
