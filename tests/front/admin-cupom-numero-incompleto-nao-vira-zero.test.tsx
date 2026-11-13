// @vitest-environment jsdom
//
// Num campo de número, texto pela metade ("1e", "-") faz o navegador entregar
// value "" com `validity.badInput`. O Number("") dava 0, e 0 em "Limite de uso"
// quer dizer ILIMITADO (em "Mínimo de compra", sem mínimo): um cupom de 10%
// limitado a 1 uso era salvo ilimitado, com "Cupom atualizado". Agora número
// incompleto BARRA o salvar e avisa no campo. Zero digitado de propósito e
// campo apagado de propósito (sem badInput) continuam valendo como antes.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ coupons: mockCoupons, addCoupon, updateCoupon }),
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

const AVISO = "Número incompleto: termine de digitar ou apague o campo.";
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

type Campo = "value" | "minPurchase" | "usageLimit";
const IDS = new Map<Campo, string>([
  ["value", "coupon-value"],
  ["minPurchase", "coupon-min-purchase"],
  ["usageLimit", "coupon-usage-limit"],
]);
const idDe = (c: Campo) => IDS.get(c) ?? "";

describe("AdminCouponFormView: número incompleto não vira zero", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
    addCoupon.mockResolvedValue({ id: "novo" });
    mockCoupons = [
      {
        id: "c1",
        code: "PROMO10",
        type: "percentage",
        value: 10,
        minPurchase: 50,
        usageLimit: 1,
        usageCount: 0,
        active: true,
      } as Coupon,
    ];
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

  const campo = (c: Campo) =>
    hospedeiro.querySelector(`#${idDe(c)}`) as HTMLInputElement;

  // O que o navegador faz com "1e" ou "-": value "" e `badInput` true. O
  // `validity` é do elemento, então o teste o define no próprio campo.
  async function digitar(c: Campo, texto: string, badInput = false) {
    const el = campo(c);
    Object.defineProperty(el, "validity", {
      configurable: true,
      value: { badInput },
    });
    await act(async () => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      setter?.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  async function salvar() {
    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find((b) =>
          (b.textContent ?? "").includes("Salvar Cupom"),
        ) as HTMLButtonElement
      ).click();
    });
  }

  for (const c of ["usageLimit", "minPurchase", "value"] as const) {
    it(`${c}: texto incompleto (badInput) não salva e avisa no campo`, async () => {
      await abrirTela("c1");
      await digitar(c, "", true);
      await salvar();

      expect(updateCoupon).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(AVISO);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(hospedeiro.querySelector(`#${idDe(c)}-erro`)?.textContent).toBe(
        AVISO,
      );
      expect(campo(c).getAttribute("aria-invalid")).toBe("true");
      expect(campo(c).getAttribute("aria-describedby")).toBe(`${idDe(c)}-erro`);
      expect(document.activeElement).toBe(campo(c));
    });
  }

  it("o limite de 1 uso não vira ilimitado: depois de corrigir, salva o número certo", async () => {
    await abrirTela("c1");
    await digitar("usageLimit", "", true);
    await salvar();
    expect(updateCoupon).not.toHaveBeenCalled();

    await digitar("usageLimit", "3");
    expect(hospedeiro.querySelector("#coupon-usage-limit-erro")).toBeNull();
    await salvar();

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(3);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("cupom novo: valor incompleto diz 'número incompleto', não 'maior que zero'", async () => {
    await abrirTela();
    const codigo = hospedeiro.querySelector("#coupon-code") as HTMLInputElement;
    await act(async () => {
      codigo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      setter?.call(codigo, "NOVO10");
      codigo.dispatchEvent(new Event("input", { bubbles: true }));
      codigo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await digitar("value", "", true);
    await salvar();

    expect(addCoupon).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO);
    expect(toast.error).not.toHaveBeenCalledWith(
      "O valor do desconto deve ser maior que zero.",
    );
  });

  it("os três incompletos: avisa um campo por vez, na ordem da tela", async () => {
    await abrirTela("c1");
    await digitar("usageLimit", "", true);
    await digitar("minPurchase", "", true);
    await digitar("value", "", true);
    await salvar();
    expect(hospedeiro.querySelector("#coupon-value-erro")).not.toBeNull();
    expect(hospedeiro.querySelector("#coupon-min-purchase-erro")).toBeNull();
    expect(hospedeiro.querySelector("#coupon-usage-limit-erro")).toBeNull();
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  // Controles: o que já valia continua valendo.
  it("0 digitado de propósito no limite continua sendo ilimitado", async () => {
    await abrirTela("c1");
    await digitar("usageLimit", "0");
    await salvar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(0);
  });

  it("0 digitado de propósito no mínimo continua sendo sem mínimo", async () => {
    await abrirTela("c1");
    await digitar("minPurchase", "0");
    await salvar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].minPurchase).toBe(0);
  });

  it("campo apagado de propósito (sem badInput) continua valendo como antes", async () => {
    await abrirTela("c1");
    await digitar("usageLimit", "", false);
    await digitar("minPurchase", "", false);
    await salvar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(0);
    expect(updateCoupon.mock.calls[0][1].minPurchase).toBe(0);
  });

  it("números válidos continuam salvando", async () => {
    await abrirTela("c1");
    await digitar("value", "15");
    await digitar("minPurchase", "80.5");
    await digitar("usageLimit", "7");
    await salvar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    const mandado = updateCoupon.mock.calls[0][1];
    expect(mandado.value).toBe(15);
    expect(mandado.minPurchase).toBe(80.5);
    expect(mandado.usageLimit).toBe(7);
  });

  it("zero no valor do desconto continua recusado pela regra de sempre", async () => {
    await abrirTela("c1");
    await digitar("value", "0");
    await salvar();

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "O valor do desconto deve ser maior que zero.",
    );
  });

  it("sem tocar em nada, o cupom aberto salva sem aviso de número incompleto", async () => {
    await abrirTela("c1");
    await salvar();

    expect(toast.error).not.toHaveBeenCalledWith(AVISO);
  });
});
