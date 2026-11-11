// @vitest-environment jsdom
//
// Cupom com código colado do WhatsApp/Word: um espaço de largura zero (U+200B)
// não é tirado pelo `trim()`. Resultado antigo: (1) código só de invisível
// passava pela guarda de "código obrigatório" e o painel gravava um cupom que
// ninguém consegue digitar; (2) "PROMO10" + invisível era gravado com o
// invisível e a cliente que digitava "PROMO10" recebia "Cupom inválido".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));

const addCoupon = vi.fn();
const updateCoupon = vi.fn();
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [],
    loading: false,
    alcanceSuportado: true,
    alcanceSondado: true,
    addCoupon,
    updateCoupon,
    listarClientesDoCupom: vi.fn().mockResolvedValue([]),
    definirClientesDoCupom: vi.fn(),
    buscarClientesParaCupom: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

describe("AdminCouponFormView — código do cupom só de caractere invisível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  async function abrirTela() {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(<AdminCouponFormView onNavigate={vi.fn()} />);
    });
    await act(async () => {});
  }

  const campo = (id: string) =>
    hospedeiro.querySelector(`#${id}`) as HTMLInputElement;

  async function digitar(id: string, valor: string) {
    const el = campo(id);
    await act(async () => {
      el.focus();
      setter?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      // Sair do campo manda o texto para o formulário.
      el.blur();
    });
  }

  async function salvar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {});
  }

  it("colar só invisível e preencher o valor: o Salvar recusa e avisa que o código é obrigatório", async () => {
    await abrirTela();
    await digitar("coupon-code", "\u200b\u200e\ufeff");
    await digitar("coupon-value", "10");
    await salvar();

    expect(toastError).toHaveBeenCalledWith("O código do cupom é obrigatório.");
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBe("true");
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("colar 'PROMO10' com invisível no fim: o código gravado é PROMO10", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10\u200b");
    await digitar("coupon-value", "10");
    await salvar();

    expect(toastError).not.toHaveBeenCalled();
    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].code).toBe("PROMO10");
  });

  it("controle: código normal 'promo10' continua virando PROMO10", async () => {
    await abrirTela();
    await digitar("coupon-code", "promo10");
    await digitar("coupon-value", "10");
    await salvar();

    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].code).toBe("PROMO10");
  });
});
