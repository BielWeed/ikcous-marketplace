// @vitest-environment jsdom
//
// Cupom com acento: o painel grava o código SEM acento (VERAO10), mas salvar
// um cupom ANTIGO sem mexer no código não pode renomeá-lo em silêncio — o
// servidor compara sem ignorar acento e o cupom já distribuído "VERÃO10"
// passaria a dar "Cupom inválido".
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ coupons: mockCoupons, addCoupon, updateCoupon }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminCouponFormView — código do cupom sem acento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateCoupon.mockReset();
    addCoupon.mockReset();
    addCoupon.mockResolvedValue({ id: "novo" });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    mockCoupons = [];
  });

  async function abrirTela(couponId?: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={couponId} onNavigate={vi.fn()} />,
      );
    });
  }

  const campoCodigo = () =>
    hospedeiro.querySelector("#coupon-code") as HTMLInputElement;

  async function salvar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
  }

  it("editar cupom antigo VERÃO10 sem mexer no código: o código enviado é o original", async () => {
    mockCoupons = [
      {
        id: "c1",
        code: "VERÃO10",
        type: "percentage",
        value: 10,
        usageCount: 3,
        active: true,
      },
    ];
    await abrirTela("c1");
    expect(campoCodigo().value).toBe("VERÃO10");

    // Entrar e sair do campo também grava o valor (blur): não pode renomear.
    await act(async () => {
      campoCodigo().focus();
      campoCodigo().blur();
    });
    await salvar();

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].code).toBe("VERÃO10");
  });

  it("cupom novo digitado 'verão10' é gravado como VERAO10", async () => {
    await abrirTela();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoCodigo(), "verão10");
      campoCodigo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campoCodigo().focus();
      campoCodigo().blur();
    });
    // valor do desconto, exigido para salvar
    const valor = hospedeiro.querySelector(
      'input[name="value"]',
    ) as HTMLInputElement | null;
    if (valor) {
      await act(async () => {
        setter?.call(valor, "10");
        valor.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        valor.focus();
        valor.blur();
      });
    }
    await salvar();

    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].code).toBe("VERAO10");
  });
});
