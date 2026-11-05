// @vitest-environment jsdom
//
// Cupom de valor FIXO aceitava centavos quebrados (7,505 ou 5,555): o campo só
// conferia "maior que zero", o servidor não arredonda o desconto fixo e o total
// do pedido saía 1 centavo diferente da conta da ficha. Agora a tela recusa o
// valor fixo com mais de 2 casas depois da vírgula, antes de salvar.
//
// A checagem é sobre o texto do número (não `valor * 100`): 7.505 * 100 dá
// 750.4999999999999 e 0.07 * 100 dá 7.000000000000001 em ponto flutuante.
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

const MENSAGEM =
  "O desconto fixo precisa ter no máximo 2 casas depois da vírgula.";

function cupomFixo(value: number): Coupon {
  return {
    id: "c1",
    code: "FIXO",
    type: "fixed",
    value,
    usageCount: 0,
    active: true,
  } as Coupon;
}

describe("AdminCouponFormView: valor fixo com no máximo 2 casas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
    mockCoupons = [cupomFixo(10)];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function digitarESalvar(id: string, texto: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(<AdminCouponFormView couponId="c1" onNavigate={vi.fn()} />);
    });
    const campo = hospedeiro.querySelector(id) as HTMLInputElement;
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

  for (const quebrado of ["7.505", "5.555", "10.005", "0.001"]) {
    it(`recusa ${quebrado} sem salvar`, async () => {
      await digitarESalvar("#coupon-value", quebrado);
      expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
      expect(updateCoupon).not.toHaveBeenCalled();
    });
  }

  for (const [valido, esperado] of [
    ["7.5", 7.5],
    ["7.55", 7.55],
    ["0.07", 0.07],
    ["12", 12],
  ] as const) {
    it(`aceita ${valido}`, async () => {
      await digitarESalvar("#coupon-value", valido);
      expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
      expect(updateCoupon).toHaveBeenCalledTimes(1);
      expect(updateCoupon.mock.calls[0][1].value).toBe(esperado);
    });
  }

  it("cupom em porcentagem não é afetado (a regra é do valor fixo)", async () => {
    mockCoupons = [{ ...cupomFixo(10), type: "percentage" } as Coupon];
    await digitarESalvar("#coupon-value", "12.555");
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
  });

  it("cupom já salvo com 3 casas, que ela não mexeu no valor, continua salvando outros campos", async () => {
    mockCoupons = [cupomFixo(7.505)];
    await digitarESalvar("#coupon-usage-limit", "5");
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1]).toEqual({ usageLimit: 5 });
  });
});
