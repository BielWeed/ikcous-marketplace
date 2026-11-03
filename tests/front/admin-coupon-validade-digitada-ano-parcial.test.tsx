// @vitest-environment jsdom
//
// No computador, a lojista digita a validade com o teclado: dia, mês e só
// depois o ano. Ao digitar o primeiro dígito do ano o navegador já avisa
// "0002-11-03", data que o formulário recusa (ano de 1 dígito não é ano real).
// Como o campo é controlado, recusar sem guardar o texto fazia o React
// reaplicar "" e apagar o que ela tinha digitado. Agora o campo guarda o texto
// enquanto a data está incompleta, e a validade só é gravada quando é válida.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCoupons: Coupon[] = [];
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    addCoupon: vi.fn(),
    updateCoupon: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminCouponFormView — validade digitada com o teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(<AdminCouponFormView onNavigate={vi.fn()} />);
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const campoData = () =>
    hospedeiro.querySelector("#coupon-valid-until") as HTMLInputElement;

  async function digitarData(valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoData(), valor);
      campoData().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const botaoLimpar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Limpar validade"),
    ) as HTMLButtonElement;

  it.each(["0002-11-03", "0020-11-03"])(
    "ano ainda incompleto (%s) não apaga o que foi digitado, nem grava a validade",
    async (parcial) => {
      await digitarData(parcial);

      expect(campoData().value).toBe(parcial);
      // Nada foi gravado: "Limpar validade" só habilita com validade de fato.
      expect(botaoLimpar().disabled).toBe(true);
    },
  );

  it("ao completar o ano a validade é gravada; limpar esvazia o campo", async () => {
    await digitarData("0002-11-03");
    await digitarData("2026-11-03");

    expect(campoData().value).toBe("2026-11-03");
    expect(botaoLimpar().disabled).toBe(false);

    await act(async () => {
      botaoLimpar().click();
    });
    expect(campoData().value).toBe("");
    expect(botaoLimpar().disabled).toBe(true);
  });

  it("apagar o campo depois de um rascunho incompleto esvazia de verdade", async () => {
    await digitarData("0002-11-03");
    await digitarData("");

    expect(campoData().value).toBe("");
  });
});
