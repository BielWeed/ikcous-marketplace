// @vitest-environment jsdom
//
// Cupom com validade no passado salvava sem aviso e nascia vencido (ninguém
// conseguia usar). O editor de banner já perguntava; o de cupom agora também:
// "essa data já passou" com "Voltar e ajustar" / "Salvar mesmo assim". Quem não
// mexeu na data de um cupom que já estava vencido não é perguntada de novo.
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

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const cupomBase = (extra: Partial<Coupon> = {}): Coupon => ({
  id: "c1",
  code: "PROMO10",
  type: "percentage",
  value: 10,
  usageCount: 0,
  active: true,
  ...extra,
});

describe("AdminCouponFormView — validade que já passou pede confirmação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateCoupon.mockReset().mockResolvedValue(undefined);
    addCoupon.mockReset().mockResolvedValue({ id: "novo" });
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

  async function abrirTela(couponId: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={couponId} onNavigate={vi.fn()} />,
      );
    });
  }

  const campoData = () =>
    hospedeiro.querySelector("#coupon-valid-until") as HTMLInputElement;

  async function escolherData(iso: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoData(), iso);
      campoData().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const botaoPorTexto = (texto: string) =>
    Array.from(document.body.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(texto),
    ) as HTMLButtonElement | undefined;

  async function salvar() {
    await act(async () => {
      botaoPorTexto("Salvar Cupom")?.click();
    });
  }

  const dataDeDiasAtras = (dias: number) =>
    new Date(Date.now() - dias * UM_DIA_MS).toISOString().slice(0, 10);

  it("data no passado: pergunta antes, 'Voltar e ajustar' não salva", async () => {
    mockCoupons = [cupomBase()];
    await abrirTela("c1");
    await escolherData(dataDeDiasAtras(10));
    await salvar();

    expect(document.body.textContent).toContain("Essa data já passou");
    expect(updateCoupon).not.toHaveBeenCalled();

    await act(async () => {
      botaoPorTexto("Voltar e ajustar")?.click();
    });
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Essa data já passou");
  });

  it("'Salvar mesmo assim' salva uma vez, com a data escolhida", async () => {
    mockCoupons = [cupomBase()];
    await abrirTela("c1");
    await escolherData(dataDeDiasAtras(10));
    await salvar();
    await act(async () => {
      botaoPorTexto("Salvar mesmo assim")?.click();
    });

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].validUntil).toBeTruthy();
  });

  it("a confirmação vale só para aquele salvar: o seguinte pergunta de novo", async () => {
    mockCoupons = [cupomBase()];
    await abrirTela("c1");
    await escolherData(dataDeDiasAtras(10));
    await salvar();
    await act(async () => {
      botaoPorTexto("Salvar mesmo assim")?.click();
    });
    updateCoupon.mockClear();
    // Mesma tela, a data continua no passado e o formulário ainda está aberto.
    await salvar();
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Essa data já passou");
  });

  it("data no futuro salva direto, sem perguntar", async () => {
    mockCoupons = [cupomBase()];
    await abrirTela("c1");
    await escolherData(
      new Date(Date.now() + 30 * UM_DIA_MS).toISOString().slice(0, 10),
    );
    await salvar();

    expect(document.body.textContent).not.toContain("Essa data já passou");
    expect(updateCoupon).toHaveBeenCalledTimes(1);
  });

  it("cupom que já estava vencido e a data não foi mexida salva sem perguntar", async () => {
    mockCoupons = [
      cupomBase({
        validUntil: new Date(Date.now() - 10 * UM_DIA_MS).toISOString(),
      }),
    ];
    await abrirTela("c1");
    // Edição manda só o que mudou (lote 260): ela desliga o cupom e a validade
    // vencida, que não tocou, nem viaja.
    await act(async () => {
      (hospedeiro.querySelector("#coupon-active") as HTMLElement).click();
    });
    await salvar();

    expect(document.body.textContent).not.toContain("Essa data já passou");
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1]).toEqual({ active: false });
  });
});
