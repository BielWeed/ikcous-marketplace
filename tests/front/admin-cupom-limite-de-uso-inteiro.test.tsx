// @vitest-environment jsdom
//
// "Limite de uso" é uma coluna inteira: 2.5 ou 3000000000 passavam pela tela e
// só quebravam (ou eram arredondados) no banco. Agora a tela recusa antes de
// salvar, com a frase "O limite de uso precisa ser um número inteiro".
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    addCoupon: vi.fn(),
    updateCoupon,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM = "O limite de uso precisa ser um número inteiro";

describe("AdminCouponFormView: limite de uso inteiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
    mockCoupons = [
      {
        id: "c1",
        code: "PROMO10",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: true,
      } as Coupon,
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function limiteESalvar(texto: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(<AdminCouponFormView couponId="c1" onNavigate={vi.fn()} />);
    });
    const campo = hospedeiro.querySelector(
      "#coupon-usage-limit",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const salvar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      salvar.click();
    });
  }

  for (const [invalido, frase] of [
    ["2.5", MENSAGEM],
    ["3000000000", "O limite de uso pode ir até 2.000.000.000"],
  ] as const) {
    it(`recusa ${invalido} sem salvar`, async () => {
      await limiteESalvar(invalido);
      expect(toast.error).toHaveBeenCalledWith(frase);
      expect(updateCoupon).not.toHaveBeenCalled();
    });
  }

  it("aceita um inteiro dentro da faixa", async () => {
    await limiteESalvar("50");
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(50);
  });
});
