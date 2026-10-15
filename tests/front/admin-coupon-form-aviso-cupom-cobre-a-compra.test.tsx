// @vitest-environment jsdom
//
// CUPOM QUE COBRE A COMPRA INTEIRA (decisão do dono, 14/10/2026): com o total
// em R$ 0,00 a cliente só fecha pagando na retirada ou na entrega. O formulário
// do cupom AVISA a lojista (nunca proíbe) quando o desconto pode zerar a
// compra, e avisa mais forte quando a loja só recebe pelo app.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
let mockFormasNaEntrega: string[] = ["pix", "card", "cash"];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ coupons: mockCoupons, addCoupon, updateCoupon }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: mockFormasNaEntrega },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO = '[data-testid="aviso-cupom-cobre-a-compra"]';
const FRASE_PADRAO =
  "Se o cupom cobrir a compra e o frete for grátis, a cliente fecha pagando na retirada ou na entrega; pelo app ou por transportadora, não fecha.";

function cupom(overrides: Partial<Coupon>): Coupon {
  return {
    id: "c1",
    code: "CUPOM",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

describe("AdminCouponFormView — aviso do cupom que pode cobrir a compra inteira", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateCoupon.mockReset();
    updateCoupon.mockResolvedValue(undefined);
    addCoupon.mockReset();
    mockFormasNaEntrega = ["pix", "card", "cash"];
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

  const aviso = () => hospedeiro.querySelector(AVISO);

  async function digitarNoCampo(nome: string, texto: string) {
    const campo = hospedeiro.querySelector(
      `input[name="${nome}"]`,
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.focus();
      campo.blur();
    });
  }

  it("cupom de 100%: o aviso aparece, com a frase combinada", async () => {
    mockCoupons = [cupom({ value: 100 })];
    await abrirTela("c1");

    expect(aviso()?.textContent).toBe(FRASE_PADRAO);
  });

  it("cupom de 10%: sem aviso", async () => {
    mockCoupons = [cupom({ value: 10 })];
    await abrirTela("c1");

    expect(aviso()).toBeNull();
  });

  it("cupom de 99%: ainda sobra produto a pagar, sem aviso", async () => {
    mockCoupons = [cupom({ value: 99 })];
    await abrirTela("c1");

    expect(aviso()).toBeNull();
  });

  it("valor fixo alto (R$ 150): o aviso aparece; valor fixo baixo (R$ 15): não", async () => {
    mockCoupons = [cupom({ type: "fixed", value: 150 })];
    await abrirTela("c1");
    expect(aviso()?.textContent).toBe(FRASE_PADRAO);

    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    mockCoupons = [cupom({ type: "fixed", value: 15 })];
    await abrirTela("c1");
    expect(aviso()).toBeNull();
  });

  it("digitando 100 no valor, o aviso aparece na hora; voltando para 10, some", async () => {
    await abrirTela();
    expect(aviso()).toBeNull();

    await digitarNoCampo("value", "100");
    expect(aviso()?.textContent).toBe(FRASE_PADRAO);

    await digitarNoCampo("value", "10");
    expect(aviso()).toBeNull();
  });

  it("loja que SÓ recebe pelo app: o aviso é o mais forte e explica que a cliente não fecha", async () => {
    mockFormasNaEntrega = [];
    mockCoupons = [cupom({ value: 100 })];
    await abrirTela("c1");

    const texto = aviso()?.textContent ?? "";
    expect(texto).toContain("sua loja só recebe pagamento pelo app");
    expect(texto).toContain("não consegue fechar o pedido");
    expect(texto).not.toBe(FRASE_PADRAO);
  });

  it("loja só-app mas cupom pequeno: nenhum aviso", async () => {
    mockFormasNaEntrega = [];
    mockCoupons = [cupom({ value: 10 })];
    await abrirTela("c1");

    expect(aviso()).toBeNull();
  });

  it("o aviso NÃO bloqueia: o cupom de 100% salva normalmente", async () => {
    mockCoupons = [cupom({ value: 100 })];
    await abrirTela("c1");
    expect(aviso()).not.toBeNull();

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].value).toBe(100);
  });
});
