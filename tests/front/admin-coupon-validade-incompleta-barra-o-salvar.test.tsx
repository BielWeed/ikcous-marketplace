// @vitest-environment jsdom
//
// No computador, a lojista digitava a validade com ano de 2 dígitos ("31/12/27"):
// o navegador entrega "0027-12-31", a tela não entendia a data, guardava só o
// texto no campo e o Salvar gravava o cupom SEM validade (ou mantinha a antiga),
// com "Cupom criado com sucesso". O cupom que devia acabar valia para sempre.
// Agora, data digitada que a tela não entendeu BARRA o salvar e avisa ao lado do
// campo. Campo vazio de propósito continua valendo como "sem validade".
import type { Coupon } from "@/types";
import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";
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

const AVISO = "Digite a validade com o ano completo, ex.: 31/12/2027";
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

describe("AdminCouponFormView — validade digitada e não entendida barra o salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCoupon.mockResolvedValue(undefined);
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

  const campoData = () =>
    hospedeiro.querySelector("#coupon-valid-until") as HTMLInputElement;

  async function digitar(campo: HTMLInputElement, valor: string) {
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  async function preencherCupomNovo() {
    await digitar(
      hospedeiro.querySelector("#coupon-code") as HTMLInputElement,
      "PROMO10",
    );
    await digitar(
      hospedeiro.querySelector("#coupon-value") as HTMLInputElement,
      "10",
    );
  }

  // O que o navegador faz com data que ele mesmo não consegue montar (31/02,
  // ou dia e mês sem ano): o value fica "" e `validity.badInput` fica true.
  function navegadorDizDataIncompleta(sim: boolean) {
    Object.defineProperty(campoData(), "validity", {
      configurable: true,
      value: { badInput: sim },
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

  const dataFutura = (dias: number) =>
    new Date(Date.now() + dias * UM_DIA_MS).toISOString().slice(0, 10);

  const cupomAntigo = (): Coupon => ({
    id: "c1",
    code: "PROMO10",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    validUntil: dataEscolhidaParaValidade(dataFutura(30)),
  });

  it("cupom novo com ano de 2 dígitos: não salva e avisa ao lado do campo", async () => {
    await abrirTela();
    await preencherCupomNovo();
    await digitar(campoData(), "0027-12-31");
    await salvar();

    expect(addCoupon).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO);
    const aviso = hospedeiro.querySelector("#coupon-valid-until-erro");
    expect(aviso?.textContent).toContain(AVISO);
    expect(campoData().getAttribute("aria-invalid")).toBe("true");
    expect(campoData().getAttribute("aria-describedby")).toContain(
      "coupon-valid-until-erro",
    );
  });

  it("cupom antigo com validade: digitar o ano com 2 dígitos não salva em silêncio", async () => {
    mockCoupons = [cupomAntigo()];
    await abrirTela("c1");
    await digitar(campoData(), "0027-12-31");
    await salvar();

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO);
  });

  it("data que o navegador não montou (31/02 ou sem ano): value vazio + badInput barra o salvar", async () => {
    await abrirTela();
    await preencherCupomNovo();
    navegadorDizDataIncompleta(true);
    // Chrome nem sempre dispara evento ao digitar só dia e mês: vale o que o
    // campo diz NA HORA de salvar, não o último evento.
    await salvar();

    expect(addCoupon).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO);
    expect(hospedeiro.querySelector("#coupon-valid-until-erro")).not.toBeNull();
  });

  it("corrigir o ano depois do aviso: salva com a data certa e o aviso some", async () => {
    await abrirTela();
    await preencherCupomNovo();
    await digitar(campoData(), "0027-12-31");
    await salvar();
    expect(addCoupon).not.toHaveBeenCalled();

    const certa = dataFutura(60);
    await digitar(campoData(), certa);
    expect(hospedeiro.querySelector("#coupon-valid-until-erro")).toBeNull();
    expect(campoData().getAttribute("aria-invalid")).not.toBe("true");
    await salvar();

    expect(addCoupon).toHaveBeenCalledTimes(1);
    const { validUntil } = addCoupon.mock.calls[0][0];
    expect(validUntil).toBe(dataEscolhidaParaValidade(certa));
    expect(validadeParaDataDoInput(validUntil)).toBe(certa);
  });

  it("apagar o campo de propósito continua valendo como 'sem validade'", async () => {
    await abrirTela();
    await preencherCupomNovo();
    await digitar(campoData(), "0027-12-31");
    await digitar(campoData(), "");
    await salvar();

    expect(toast.error).not.toHaveBeenCalledWith(AVISO);
    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].validUntil).toBeUndefined();
  });

  it("campo nunca tocado: cupom novo sem validade salva normalmente", async () => {
    await abrirTela();
    await preencherCupomNovo();
    navegadorDizDataIncompleta(false);
    await salvar();

    expect(toast.error).not.toHaveBeenCalledWith(AVISO);
    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].validUntil).toBeUndefined();
  });

  it("ano de 4 dígitos no futuro grava até o fim daquele dia", async () => {
    await abrirTela();
    await preencherCupomNovo();
    await digitar(campoData(), "2099-12-31");
    await salvar();

    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0].validUntil).toBe(
      dataEscolhidaParaValidade("2099-12-31"),
    );
  });

  it("ao sair do campo com a data incompleta, o aviso já aparece (sem esperar o Salvar)", async () => {
    await abrirTela();
    await digitar(campoData(), "0027-12-31");

    expect(hospedeiro.querySelector("#coupon-valid-until-erro")).not.toBeNull();
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("data no passado com ano completo continua perguntando, não é barrada como incompleta", async () => {
    mockCoupons = [cupomAntigo()];
    await abrirTela("c1");
    const passada = new Date(Date.now() - 10 * UM_DIA_MS)
      .toISOString()
      .slice(0, 10);
    await digitar(campoData(), passada);
    await salvar();

    expect(toast.error).not.toHaveBeenCalledWith(AVISO);
    expect(document.body.textContent).toContain("Essa data já passou");
    expect(updateCoupon).not.toHaveBeenCalled();
  });
});
