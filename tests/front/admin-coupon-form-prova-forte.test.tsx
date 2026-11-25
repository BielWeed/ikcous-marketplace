// @vitest-environment jsdom
//
// Provas fortes do formulário de cupom (AdminCouponFormView) nos limites que
// decidem se o cupom é gravado: o código de EXATAMENTE 40 caracteres entra, o
// de 41 não; a mensagem diz o limite certo; e o que sai para o banco é o que
// foi digitado. Valores escritos à mão.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const addCoupon = vi.fn();
const updateCoupon = vi.fn();
const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    addCoupon,
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

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onNavigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  addCoupon.mockResolvedValue({ id: "novo" });
  updateCoupon.mockResolvedValue(undefined);
  mockCoupons = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function abrirFormularioNovo() {
  const { AdminCouponFormView } = await import(
    "@/views/admin/AdminCouponFormView"
  );
  await act(async () => {
    raiz.render(<AdminCouponFormView onNavigate={onNavigate} />);
  });
}

async function digitar(seletor: string, texto: string) {
  const campo = hospedeiro.querySelector(seletor) as HTMLInputElement;
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
}

async function salvar() {
  const botao = Array.from(document.body.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Salvar Cupom"),
  ) as HTMLButtonElement;
  await act(async () => {
    botao.click();
  });
}

describe("Cupom novo — tamanho do código", () => {
  it("40 caracteres exatos é aceito e vai inteiro, em maiúsculas, para o banco", async () => {
    await abrirFormularioNovo();
    const codigo = "A".repeat(40);
    await digitar("#coupon-code", codigo);
    await digitar("#coupon-value", "10");
    await salvar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].code).toBe(codigo);
    expect(addCoupon.mock.calls[0][0].value).toBe(10);
  });

  it("41 caracteres é recusado, com o limite dito na mensagem, sem gravar", async () => {
    await abrirFormularioNovo();
    await digitar("#coupon-code", "B".repeat(41));
    await digitar("#coupon-value", "10");
    await salvar();

    expect(toast.error).toHaveBeenCalledWith(
      "Use um código com até 40 caracteres.",
    );
    expect(addCoupon).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("Cupom existente — trocar o tipo do desconto reabre a conferência dos centavos", () => {
  const MENSAGEM =
    "O desconto fixo precisa ter no máximo 2 casas depois da vírgula.";

  it("percentual de 12,555% passado para R$ Fixo, sem mexer no número, NÃO é gravado como R$ 12,555", async () => {
    mockCoupons = [
      {
        id: "c1",
        code: "PERC",
        type: "percentage",
        value: 12.555,
        usageCount: 0,
        active: true,
      } as Coupon,
    ];
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId="c1" onNavigate={onNavigate} />,
      );
    });
    const fixo = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("R$ Fixo"),
    ) as HTMLButtonElement;
    await act(async () => {
      fixo.click();
    });
    await salvar();

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  it("controle: o mesmo cupom percentual, sem trocar o tipo e sem mexer no valor, ainda salva outro campo", async () => {
    mockCoupons = [
      {
        id: "c1",
        code: "PERC",
        type: "percentage",
        value: 12.555,
        usageCount: 0,
        active: true,
      } as Coupon,
    ];
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId="c1" onNavigate={onNavigate} />,
      );
    });
    await digitar("#coupon-usage-limit", "5");
    await salvar();

    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1]).toEqual({ usageLimit: 5 });
  });
});
