// @vitest-environment jsdom
//
// Regressão: type="number" perde a vírgula brasileira antes de o formulário
// ler "1.200,00". Exercita o campo real e a saída entregue para gravar, sem
// mascarar LocalBufferedInput nem reproduzir o parser no teste.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ coupons: mockCoupons, updateCoupon, addCoupon }),
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

describe("AdminCouponFormView: dinheiro brasileiro não perde o milhar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
    mockCoupons = [
      {
        id: "c1",
        code: "REAIS",
        type: "fixed",
        value: 10,
        minPurchase: 50,
        usageCount: 0,
        active: true,
      },
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(novo = false) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView
          couponId={novo ? undefined : "c1"}
          onNavigate={vi.fn()}
        />,
      );
    });
  }
  const campo = (nome: "value" | "minPurchase" | "code") =>
    hospedeiro.querySelector<HTMLInputElement>(
      nome === "value"
        ? "#coupon-value"
        : nome === "minPurchase"
          ? "#coupon-min-purchase"
          : "#coupon-code",
    ) as HTMLInputElement;

  async function digitar(
    nome: "value" | "minPurchase" | "code",
    texto: string,
  ) {
    const el = campo(nome);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      setter?.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }
  async function salvar() {
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => botao.click());
  }

  for (const nome of ["value", "minPurchase"] as const) {
    // Regra de parseValorBR: ponto com grupo de 3 dígitos é MILHAR,
    // mesmo sem vírgula. Centavos excedentes são escritos com vírgula.
    for (const [texto, reais] of [
      ["1.200,00", 1200],
      ["1200,50", 1200.5],
      ["1.200", 1200],
      ["1200", 1200],
    ] as const) {
      it(`${nome}: salva "${texto}" como ${reais} reais`, async () => {
        await abrir();
        await digitar(nome, texto);
        await salvar();
        expect(toast.error).not.toHaveBeenCalled();
        expect(updateCoupon).toHaveBeenCalledTimes(1);
        const gravado = updateCoupon.mock.calls[0][1];
        expect(nome === "value" ? gravado.value : gravado.minPurchase).toBe(
          reais,
        );
      });
    }

    for (const invalido of [
      ...(nome === "value" ? [""] : []),
      "12,345",
      "12,340",
      "abc",
      "1e",
      "-",
      "1,",
      ",",
      "-1",
    ]) {
      it(`${nome}: "${invalido}" não vira zero nem outro valor válido`, async () => {
        await abrir();
        await digitar(nome, invalido);
        await salvar();
        expect(updateCoupon).not.toHaveBeenCalled();
        expect(campo(nome).getAttribute("aria-invalid")).toBe("true");
        expect(document.activeElement).toBe(campo(nome));
        expect(toast.error).toHaveBeenCalledTimes(1);
      });
    }
  }

  it.each(["", "   "])(
    "R3: apagar mínimo inválido para %j volta a significar sem mínimo",
    async (vazio) => {
      await abrir();
      await digitar("minPurchase", "abc");
      await salvar();
      expect(updateCoupon).not.toHaveBeenCalled();
      await digitar("minPurchase", vazio);
      await salvar();
      expect(updateCoupon).toHaveBeenCalledExactlyOnceWith("c1", {
        minPurchase: 0,
      });
    },
  );

  for (const nome of ["value", "minPurchase"] as const) {
    it(`Menor: ${nome} aceita espaços só nas pontas sem acusar casas decimais`, async () => {
      await abrir();
      await digitar(nome, " 1.200,00 ");
      await salvar();
      expect(toast.error).not.toHaveBeenCalled();
      const gravado = updateCoupon.mock.calls[0][1];
      expect(nome === "value" ? gravado.value : gravado.minPurchase).toBe(1200);
    });
    it(`Menor: ${nome} recusa espaço no meio com o motivo correto`, async () => {
      await abrir();
      await digitar(nome, " 1 200,00 ");
      await salvar();
      expect(updateCoupon).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        nome === "value"
          ? "Digite um valor de desconto válido."
          : "Digite um mínimo de compra válido (0 = sem mínimo).",
      );
    });
  }

  it("R1: cupom novo fixo começa vazio, sem zero para se misturar ao desconto", async () => {
    await abrir(true);
    const fixo = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.textContent?.includes("R$ Fixo"),
    ) as HTMLButtonElement;
    await act(async () => fixo.click());
    expect(campo("value").value).toBe("");
    expect(campo("value").placeholder).toBe("EX: 15");
    await digitar("value", "15");
    expect(campo("value").value).toBe("15");
  });

  it("R1: mínimo zero fica vazio e o valor existente continua formatado", async () => {
    mockCoupons = [{ ...mockCoupons[0], value: 1200, minPurchase: 0 }];
    await abrir();
    expect(campo("value").value).toBe("1.200,00");
    expect(campo("minPurchase").value).toBe("");
    expect(campo("minPurchase").placeholder).toBe("EX: 50");
  });

  it("ao editar, mostra milhar e centavos e mantém a prévia e o resumo", async () => {
    mockCoupons = [{ ...mockCoupons[0], value: 1200, minPurchase: 2400.5 }];
    await abrir();
    expect(campo("value").value).toBe("1.200,00");
    expect(campo("minPurchase").value).toBe("2.400,50");
    await digitar("value", "1200,50");
    await digitar("minPurchase", "2.500,00");
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-controls="coupon-preview"]')
        ?.click();
    });
    const texto = (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("REAIS · R$ 1.200,50 · mín. R$ 2.500,00");
    expect(texto).toMatch(/Desconto\s*R\$ 1.200,50/);
    expect(texto).toContain("R$ 2.500,00");
    await salvar();
    expect(updateCoupon.mock.calls[0][1]).toMatchObject({
      value: 1200.5,
      minPurchase: 2500,
    });
  });

  it("R2: só passar pelos campos de dinheiro antigo não altera valor nem tipo", async () => {
    mockCoupons = [{ ...mockCoupons[0], value: 7.505, minPurchase: 49.991 }];
    await abrir();
    expect(campo("value").value).toBe("7,51");
    expect(campo("minPurchase").value).toBe("49,99");
    for (const nome of ["value", "minPurchase"] as const) {
      await act(async () => {
        campo(nome).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      await act(async () => {
        campo(nome).dispatchEvent(
          new FocusEvent("focusout", { bubbles: true }),
        );
      });
    }
    await digitar("code", "OUTRONOME");
    await salvar();
    expect(toast.error).not.toHaveBeenCalled();
    expect(updateCoupon).toHaveBeenCalledExactlyOnceWith("c1", {
      code: "OUTRONOME",
    });
  });

  it("não arredonda um cupom antigo intocado ao salvar outro campo", async () => {
    mockCoupons = [{ ...mockCoupons[0], value: 7.505, minPurchase: 49.991 }];
    await abrir();
    await digitar("minPurchase", "50,00");
    await salvar();
    expect(updateCoupon.mock.calls[0][1]).toEqual({ minPurchase: 50 });
  });

  it("trocar de tipo não reaproveita o texto antigo do desconto fixo", async () => {
    await abrir();
    await digitar("value", "12,00");
    const tipo = (nome: string) =>
      Array.from(hospedeiro.querySelectorAll("button")).find((botao) =>
        botao.textContent?.includes(nome),
      ) as HTMLButtonElement;
    await act(async () => tipo("Percentual").click());
    await digitar("value", "15");
    await act(async () => tipo("Fixo").click());
    expect(campo("value").value).toBe("15,00");
    await salvar();
    expect(updateCoupon.mock.calls[0][1].value).toBe(15);
  });

  it("percentual continua numérico e permite suas casas decimais", async () => {
    mockCoupons = [{ ...mockCoupons[0], type: "percentage" }];
    await abrir();
    expect(campo("value").type).toBe("number");
    await digitar("value", "12.555");
    await salvar();
    expect(updateCoupon.mock.calls[0][1].value).toBe(12.555);
  });
});
