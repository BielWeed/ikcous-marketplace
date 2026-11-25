// @vitest-environment jsdom
//
// Provas fortes da lista de Cupons do painel (AdminCouponsView): o interruptor
// de cada cupom grava o que a lojista escolheu (não o contrário) e não deixa
// dois toques repetirem o pedido; os números do topo contam o grupo certo.
// Valores escritos à mão.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
let offline = false;
const updateCoupon = vi.fn();
const deleteCoupon = vi.fn();
const updateConfig = vi.fn();
const onNavigate = vi.fn();
let mockConfig: Record<string, unknown> = { enableCoupons: true };

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
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => offline }));
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
  offline = false;
  mockConfig = { enableCoupons: true };
  updateCoupon.mockResolvedValue(undefined);
  updateConfig.mockResolvedValue(true);
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

async function abrirTela() {
  const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
  await act(async () => {
    raiz.render(<AdminCouponsView active={true} onNavigate={onNavigate} />);
  });
}

const textoDaTela = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
const interruptor = (codigo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="Ativação manual de ${codigo}"]`,
  )!;
const porRotulo = (rotulo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`)!;

async function abrirMetricas() {
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>('[aria-controls="coupon-metrics"]')
      ?.click();
  });
}

describe("Cupons — interruptor de cada cupom", () => {
  it("desligar um cupom ativo grava active:false; ligar um desligado grava active:true", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "LIGADO", active: true }),
      cupom({ id: "b", code: "DESLIGADO", active: false }),
    ];
    await abrirTela();

    await act(async () => {
      interruptor("LIGADO").click();
    });
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon).toHaveBeenLastCalledWith("a", { active: false });

    await act(async () => {
      interruptor("DESLIGADO").click();
    });
    expect(updateCoupon).toHaveBeenCalledTimes(2);
    expect(updateCoupon).toHaveBeenLastCalledWith("b", { active: true });
  });

  it("dois toques seguidos no mesmo cupom mandam UM pedido só, e o interruptor fica travado até responder", async () => {
    mockCoupons = [cupom({ id: "a", code: "LIGADO" })];
    let responder: () => void = () => {};
    updateCoupon.mockImplementation(
      () =>
        new Promise<void>((resolver) => {
          responder = resolver;
        }),
    );
    await abrirTela();

    // os dois toques chegam antes de a tela redesenhar: só a trava interna segura
    await act(async () => {
      interruptor("LIGADO").click();
      interruptor("LIGADO").click();
    });
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(interruptor("LIGADO").disabled).toBe(true);
    expect(interruptor("LIGADO").getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      responder();
    });
    expect(interruptor("LIGADO").disabled).toBe(false);
    expect(interruptor("LIGADO").getAttribute("aria-busy")).toBe("false");
  });

  it("travar um cupom não trava o vizinho", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "UM" }),
      cupom({ id: "b", code: "DOIS" }),
    ];
    updateCoupon.mockImplementation(() => new Promise<void>(() => {}));
    await abrirTela();

    await act(async () => {
      interruptor("UM").click();
    });
    expect(interruptor("UM").disabled).toBe(true);
    expect(interruptor("DOIS").disabled).toBe(false);
  });

  it("sem internet, o interruptor não grava nada", async () => {
    offline = true;
    mockCoupons = [cupom({ id: "a", code: "LIGADO" })];
    await abrirTela();
    expect(interruptor("LIGADO").disabled).toBe(true);
    await act(async () => {
      interruptor("LIGADO").click();
    });
    expect(updateCoupon).not.toHaveBeenCalled();
  });
});

describe("Cupons — números do topo", () => {
  it("'Cupons Ativos' mostra quantos o checkout aceita sobre o total de cadastrados (1 de 3)", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "A1", active: true }),
      cupom({ id: "b", code: "B2", active: false }),
      cupom({ id: "c", code: "C3", active: false }),
    ];
    await abrirTela();
    // recolhido: "1 / 3"
    expect(textoDaTela()).toMatch(/Cupons Ativos/);
    expect(textoDaTela()).toMatch(/1 \/ 3 total/);
    await abrirMetricas();
    // aberto: valor e a legenda "/ 3 total"
    expect(textoDaTela()).toMatch(/Cupons Ativos\s*1\s*\/ 3 total/);
  });

  it("'Usos contabilizados' soma os usos de TODOS os cupons (3 + 4 = 7)", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "A1", usageCount: 3 }),
      cupom({ id: "b", code: "B2", usageCount: 4, active: false }),
    ];
    await abrirTela();
    expect(textoDaTela()).toMatch(/Usos contabilizados/);
    expect(textoDaTela()).toMatch(/Usos contabilizados\s*7/);
  });
});

describe("Cupons — para onde cada botão leva", () => {
  it("'Novo Cupom' abre o formulário em branco (sem id)", async () => {
    mockCoupons = [cupom({ id: "a", code: "A1" })];
    await abrirTela();
    const novo = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Novo Cupom"),
    )!;
    await act(async () => {
      novo.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]).toEqual(["admin-coupon-form"]);
  });

  it("sem nenhum cupom, 'Criar Primeiro Cupom' abre o formulário em branco", async () => {
    mockCoupons = [];
    await abrirTela();
    const criar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Criar Primeiro"),
    )!;
    await act(async () => {
      criar.click();
    });
    expect(onNavigate.mock.calls).toEqual([["admin-coupon-form"]]);
  });

  it("'Editar' abre o formulário COM o id do cupom daquele cartão", async () => {
    mockCoupons = [
      cupom({ id: "id-a", code: "A1" }),
      cupom({ id: "id-b", code: "B2" }),
    ];
    await abrirTela();
    const editar = Array.from(hospedeiro.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Editar",
    );
    expect(editar).toHaveLength(2);
    await act(async () => {
      editar[1].click();
    });
    expect(onNavigate.mock.calls).toEqual([["admin-coupon-form", "id-b"]]);
  });
});

describe("Cupons — excluir e detalhes", () => {
  it("dois toques em 'Excluir cupom' na confirmação apagam UMA vez só", async () => {
    mockCoupons = [cupom({ id: "a", code: "A1" })];
    deleteCoupon.mockImplementation(() => new Promise<void>(() => {}));
    await abrirTela();
    await act(async () => {
      porRotulo("Excluir cupom A1").click();
    });
    const confirmar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Excluir cupom",
    )!;
    await act(async () => {
      confirmar.click();
      confirmar.click();
    });
    expect(deleteCoupon.mock.calls).toEqual([["a"]]);
  });

  it("a barra de uso mostra a proporção (25 de 100 = 25%) e nunca passa de 100% (150 de 100)", async () => {
    mockCoupons = [
      cupom({ id: "a", code: "A1", usageCount: 25, usageLimit: 100 }),
      cupom({ id: "b", code: "B2", usageCount: 150, usageLimit: 100 }),
    ];
    await abrirTela();
    for (const codigo of ["A1", "B2"]) {
      await act(async () => {
        porRotulo(`Detalhes do cupom ${codigo}`).click();
      });
    }
    const largura = (id: string) =>
      hospedeiro.querySelector<HTMLElement>(
        `#coupon-details-${id} .bg-violet-300`,
      )?.style.width;
    expect(largura("a")).toBe("25%");
    expect(largura("b")).toBe("100%");
  });
});
