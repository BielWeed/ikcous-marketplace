// @vitest-environment jsdom
//
// Ao editar um cupom usado uma única vez, o formulário dizia "1 utilizações
// acumuladas". No singular é "1 utilização acumulada".
import type { Coupon } from "@/types";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cupons: Coupon[] = [];

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: cupons,
    loading: false,
    addCoupon: vi.fn(),
    updateCoupon: vi.fn(),
    alcanceSuportado: true,
    alcanceSondado: true,
    listarClientesDoCupom: vi.fn().mockResolvedValue([]),
    buscarClientesParaCupom: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { formasPagamentoEntrega: ["cash"] } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function cupomUsado(vezes: number): Coupon {
  return {
    id: "cupom-a",
    code: "CUPOMA",
    type: "fixed",
    value: 10,
    minPurchase: 0,
    usageLimit: 5,
    active: true,
    alcance: "codigo",
    usageCount: vezes,
  };
}

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.unstubAllGlobals();
});

async function editar(cupom: Coupon) {
  cupons = [cupom];
  await act(async () => {
    raiz.render(
      <AdminCouponFormView
        couponId={cupom.id}
        onNavigate={vi.fn()}
        onSetDirty={vi.fn()}
      />,
    );
  });
}

describe("formulário de cupom — contador de utilizações", () => {
  it("uma utilização: singular", async () => {
    await editar(cupomUsado(1));
    const texto = tela.textContent ?? "";
    expect(texto).toContain("1 utilização acumulada. O contador");
    expect(texto).not.toContain("1 utilizações");
  });

  it("várias utilizações: plural", async () => {
    await editar(cupomUsado(3));
    expect(tela.textContent).toContain("3 utilizações acumuladas. O contador");
  });
});
