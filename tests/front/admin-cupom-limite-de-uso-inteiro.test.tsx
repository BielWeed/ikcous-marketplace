// @vitest-environment jsdom
//
// O limite chega inteiro ao banco. A tela aceita a colagem de milhares em
// pt-BR e recusa números fracionários, malformados ou acima do teto.
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

const MENSAGEM = "Digite só números inteiros, por exemplo 1000 ou 1.000.";

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

  async function limiteESalvar(texto: string, sairDoCampo = true) {
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
      campo.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: texto,
          inputType: "insertFromPaste",
        }),
      );
      if (sairDoCampo) {
        campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      }
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

  it("salva 1.000 colado como mil usos, não como um uso", async () => {
    await limiteESalvar("1.000");

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(1000);
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#coupon-usage-limit",
    );
    expect(campo?.value).toMatch(/^1\.?000$/);
  });

  it("mantém o texto decimal visível e orienta a corrigir antes de salvar", async () => {
    await limiteESalvar("1.5");

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector("#coupon-usage-limit-erro")?.textContent,
    ).toBe(MENSAGEM);
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#coupon-usage-limit")?.value,
    ).toBe("1.5");
  });

  it("valida a colagem mesmo se Salvar for acionado sem sair do campo", async () => {
    await limiteESalvar("1.5", false);

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
  });

  it("aceita um inteiro dentro da faixa", async () => {
    await limiteESalvar("50");
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].usageLimit).toBe(50);
  });
});
