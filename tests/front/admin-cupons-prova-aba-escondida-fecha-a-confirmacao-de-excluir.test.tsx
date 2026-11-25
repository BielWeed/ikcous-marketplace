// @vitest-environment jsdom
//
// Prova forte da lista de Cupons do painel (25/11/2026, caça por mutação).
// Defeito de uma linha que os testes vizinhos deixavam passar: a pergunta
// "Excluir cupom?" aberta numa aba do painel continuava de pé quando a lojista
// trocava de aba (a tela fica montada, só deixa de estar ativa). Ao voltar, o
// botão vermelho "Excluir cupom" estava ali, esperando um toque às cegas num
// cupom que ela já tinha esquecido.
// Valores escritos à mão; só fixtures inventadas.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const deleteCoupon = vi.fn();
const updateConfig = vi.fn();
const onNavigate = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    loading: false,
    updateCoupon,
    deleteCoupon,
    refreshCoupons: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cupom(overrides: Partial<Coupon>): Coupon {
  return {
    id: "cupom-1",
    code: "CODIGO",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  updateConfig.mockResolvedValue(true);
  deleteCoupon.mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
  mockCoupons = [];
});

async function renderizar(ativa: boolean) {
  const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
  await act(async () => {
    raiz.render(<AdminCouponsView active={ativa} onNavigate={onNavigate} />);
  });
}

const porRotulo = (rotulo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`)!;
const confirmacaoAberta = () =>
  document.body.querySelector('[role="alertdialog"]');
const botaoDeConfirmar = () =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Excluir cupom",
  );

describe("Cupons — a pergunta de excluir não sobrevive a uma troca de aba", () => {
  it("aberta a pergunta e a aba deixando de estar ativa, ela some; ao voltar, não há confirmação à espera", async () => {
    mockCoupons = [cupom({ id: "a", code: "A1" })];
    await renderizar(true);

    await act(async () => {
      porRotulo("Excluir cupom A1").click();
    });
    expect(confirmacaoAberta()).not.toBeNull();
    expect(document.body.textContent).toContain("Excluir cupom?");
    expect(botaoDeConfirmar()).toBeDefined();

    await renderizar(false);
    expect(confirmacaoAberta()).toBeNull();
    expect(botaoDeConfirmar()).toBeUndefined();

    await renderizar(true);
    expect(confirmacaoAberta()).toBeNull();
    expect(botaoDeConfirmar()).toBeUndefined();
    expect(deleteCoupon).not.toHaveBeenCalled();
  });

  it("controle: com a aba ativa, a pergunta continua aberta até a lojista decidir (nada fecha sozinho)", async () => {
    mockCoupons = [cupom({ id: "a", code: "A1" })];
    await renderizar(true);

    await act(async () => {
      porRotulo("Excluir cupom A1").click();
    });
    await renderizar(true);

    expect(confirmacaoAberta()).not.toBeNull();
    expect(deleteCoupon).not.toHaveBeenCalled();

    await act(async () => {
      botaoDeConfirmar()?.click();
    });
    expect(deleteCoupon.mock.calls).toEqual([["a"]]);
  });
});
