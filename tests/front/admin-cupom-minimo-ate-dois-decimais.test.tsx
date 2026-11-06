// @vitest-environment jsdom
//
// Cupom com MÍNIMO DE COMPRA de 3 casas (49,991): o campo aceitava, o servidor
// compara o subtotal em centavos e a cliente via "Faltam R$ 0,00" sem poder
// usar o cupom. Agora a tela recusa o mínimo com mais de 2 casas depois da
// vírgula, antes de salvar — para qualquer tipo de cupom. É a mesma conferência
// do TEXTO do número que o desconto fixo já faz (ver
// admin-cupom-valor-fixo-ate-dois-decimais.test.tsx).
//
// O limite que importa: valor válido (2 casas ou menos) continua aceito, e
// cupom antigo salvo com 3 casas, cujo mínimo ela não mexeu, continua salvando
// os outros campos.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

const MENSAGEM =
  "O mínimo de compra precisa ter no máximo 2 casas depois da vírgula.";

function cupom(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: "c1",
    code: "MINIMO",
    type: "fixed",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  } as Coupon;
}

describe("AdminCouponFormView: mínimo de compra com no máximo 2 casas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
    addCoupon.mockResolvedValue(undefined);
    mockCoupons = [cupom()];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(couponId?: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={couponId} onNavigate={vi.fn()} />,
      );
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
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
  }

  async function digitarMinimoESalvar(texto: string) {
    await abrir("c1");
    await digitar("#coupon-min-purchase", texto);
    await salvar();
  }

  for (const quebrado of ["49.991", "0.001", "10.005", "99.999"]) {
    it(`recusa o mínimo ${quebrado} sem salvar`, async () => {
      await digitarMinimoESalvar(quebrado);
      expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
      expect(updateCoupon).not.toHaveBeenCalled();
    });
  }

  for (const [valido, esperado] of [
    ["49.99", 49.99],
    ["49.9", 49.9],
    ["0.07", 0.07],
    ["50", 50],
  ] as const) {
    it(`aceita o mínimo ${valido} (valor válido continua salvando)`, async () => {
      await digitarMinimoESalvar(valido);
      expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
      expect(updateCoupon).toHaveBeenCalledTimes(1);
      expect(updateCoupon.mock.calls[0][1].minPurchase).toBe(esperado);
    });
  }

  it("vale também para cupom em porcentagem", async () => {
    mockCoupons = [cupom({ type: "percentage", value: 10 })];
    await digitarMinimoESalvar("49.991");
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  it("vale ao criar um cupom novo", async () => {
    mockCoupons = [];
    await abrir(undefined);
    await digitar("#coupon-code", "NOVO10");
    await digitar("#coupon-value", "10");
    await digitar("#coupon-min-purchase", "49.991");
    await salvar();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("cupom novo com mínimo de 2 casas é criado", async () => {
    mockCoupons = [];
    await abrir(undefined);
    await digitar("#coupon-code", "NOVO10");
    await digitar("#coupon-value", "10");
    await digitar("#coupon-min-purchase", "49.99");
    await salvar();
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(addCoupon).toHaveBeenCalledTimes(1);
  });

  it("cupom já salvo com 3 casas, que ela não mexeu no mínimo, continua salvando outros campos", async () => {
    mockCoupons = [cupom({ minPurchase: 49.991 })];
    await abrir("c1");
    await digitar("#coupon-usage-limit", "5");
    await salvar();
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1]).toEqual({ usageLimit: 5 });
  });

  it("cupom já salvo com 3 casas é recusado se ela mexer no mínimo e deixar outro valor de 3 casas", async () => {
    mockCoupons = [cupom({ minPurchase: 49.991 })];
    await abrir("c1");
    await digitar("#coupon-min-purchase", "49.995");
    await salvar();
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  it("cupom já salvo com 3 casas pode ser corrigido para 2 casas", async () => {
    mockCoupons = [cupom({ minPurchase: 49.991 })];
    await abrir("c1");
    await digitar("#coupon-min-purchase", "49.99");
    await salvar();
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM);
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].minPurchase).toBe(49.99);
  });
});
