// @vitest-environment jsdom
//
// AVISO DE "DESCARTAR ALTERAÇÕES?" DO FORMULÁRIO DE CUPOM (lote r130-c).
// O formulário avisa o App (`onSetDirty`) de que há edição não salva, e o App
// pergunta antes de deixar a lojista sair. Cada campo tem a sua cláusula no
// `isDirty`: sem ela, quem mexe só naquele campo (valor, mínimo, limite, validade,
// tipo, quem pode usar, ativação) toca em voltar e perde o que digitou sem
// pergunta. Os vizinhos só afirmam `true` depois de editar o CÓDIGO (ou a lista
// de clientes); aqui é um caso por campo, abrindo um cupom existente, mudando
// SÓ aquele campo (último aviso = true) e voltando ao original (último = false).
import type { Coupon } from "@/types";
import { dataEscolhidaParaValidade } from "@/utils/validade-do-cupom";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));

// Estável entre renderizações: o efeito do `isDirty` depende destas referências.
const cupom: Coupon = {
  id: "cupom-1",
  code: "DEZ",
  type: "percentage",
  value: 10,
  minPurchase: 50,
  usageLimit: 5,
  validUntil: dataEscolhidaParaValidade("2099-12-31"),
  active: true,
  alcance: "codigo",
  usageCount: 0,
};
const listaDeCupons = [cupom];
const hook = {
  coupons: listaDeCupons,
  loading: false,
  alcanceSuportado: true,
  alcanceSondado: true,
  addCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  listarClientesDoCupom: vi.fn().mockResolvedValue([]),
  definirClientesDoCupom: vi.fn(),
  buscarClientesParaCupom: vi.fn(),
  refreshCoupons: vi.fn(),
};
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => hook }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminCouponFormView — aviso de descartar, um caso por campo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const marcarAlterado = vi.fn();

  beforeEach(() => {
    marcarAlterado.mockClear();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrir() {
    await act(async () => {
      raiz.render(
        <AdminCouponFormView
          couponId="cupom-1"
          onNavigate={vi.fn()}
          onSetDirty={marcarAlterado}
        />,
      );
    });
    await act(async () => {});
  }

  const ultimoAviso = () => marcarAlterado.mock.lastCall?.[0];

  async function digitar(seletor: string, valor: string) {
    const campo = hospedeiro.querySelector<HTMLInputElement>(seletor);
    if (!campo) throw new Error(`campo ${seletor} não encontrado`);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Os campos numéricos gravam depois de um respiro (200 ms de buffer).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  async function clicarBotao(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith(texto),
    );
    if (!botao) throw new Error(`botão "${texto}" não encontrado`);
    await act(async () => botao.click());
  }

  // A ativação é uma chave (Switch), não um botão com texto.
  async function alternarAtivacao() {
    const chave = hospedeiro.querySelector<HTMLButtonElement>("#coupon-active");
    await act(async () => chave?.click());
  }

  const campos: ReadonlyArray<
    readonly [string, () => Promise<void>, () => Promise<void>]
  > = [
    [
      "valor",
      () => digitar("#coupon-value", "20"),
      () => digitar("#coupon-value", "10"),
    ],
    [
      "mínimo de compra",
      () => digitar("#coupon-min-purchase", "60"),
      () => digitar("#coupon-min-purchase", "50"),
    ],
    [
      "limite de uso",
      () => digitar("#coupon-usage-limit", "7"),
      () => digitar("#coupon-usage-limit", "5"),
    ],
    [
      "validade",
      () => digitar("#coupon-valid-until", "2099-12-30"),
      () => digitar("#coupon-valid-until", "2099-12-31"),
    ],
    [
      "tipo de desconto",
      () => clicarBotao("R$ Fixo"),
      () => clicarBotao("% Percentual"),
    ],
    [
      "quem pode usar",
      () => clicarBotao("Todos os clientes"),
      () => clicarBotao("Quem tiver o código"),
    ],
    ["ativação", alternarAtivacao, alternarAtivacao],
  ];

  it("ao abrir o cupom sem mexer em nada, o aviso fica em false", async () => {
    await abrir();
    expect(marcarAlterado).toHaveBeenCalled();
    expect(ultimoAviso()).toBe(false);
  });

  it.each(campos)(
    "mexer só em %s liga o aviso; voltar ao original desliga",
    async (_campo, mudar, voltar) => {
      await abrir();
      expect(ultimoAviso()).toBe(false);

      await mudar();
      expect(ultimoAviso()).toBe(true);

      await voltar();
      expect(ultimoAviso()).toBe(false);
    },
  );
});
