// @vitest-environment jsdom
//
// Defeito: o cupom vale até o ÚLTIMO milissegundo do dia escolhido (23:59:59.999
// em São Paulo), então ele vence exatamente na meia-noite. A tela de Cupons
// calcula o selo ("Ativo"/"Expirado") e o cartão "Cupons Ativos — Disponíveis
// para uso" ao desenhar, mas nada a desenhava de novo na virada: com a tela
// aberta de 23h59 a 00h01, o cupom que acabou de vencer seguia verde e contado.
// Agora a tela acompanha o dia da loja (`useDiaDeSaoPaulo`) e redesenha na
// virada. Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const refreshCoupons = vi.fn<() => void>();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true, formasPagamentoEntrega: ["cash"] },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-11-13T03:00:10Z"; // 13/11, 00:00:10 em SP

// "Vale até 12/11": o fim do dia de São Paulo, como o formulário grava.
const VENCE_NA_VIRADA: Coupon = {
  id: "c-12-11",
  code: "ATE1211",
  type: "percentage",
  value: 10,
  usageCount: 0,
  active: true,
  validUntil: "2026-11-13T02:59:59.999Z",
};
const SEM_VALIDADE: Coupon = {
  id: "c-sem",
  code: "SEMPRE",
  type: "percentage",
  value: 20,
  usageCount: 0,
  active: true,
};

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AdminCouponsView — acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    refreshCoupons.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockCoupons = [VENCE_NA_VIRADA, SEM_VALIDADE];
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    mockCoupons = [];
  });

  async function abrir(ativa: boolean) {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={ativa} onNavigate={vi.fn()} />);
    });
  }

  // O cartão "Cupons Ativos": o número grande e o "/ total" que vem junto.
  const cartaoDosAtivos = () =>
    (hospedeiro.textContent ?? "").match(/Cupons Ativos\s*(\d+)\s*\/\s*(\d+)/);
  const selosDeExpirado = () =>
    (hospedeiro.textContent ?? "").match(/Expirado/g)?.length ?? 0;

  it("o cupom que vence na meia-noite deixa de contar e ganha o selo Expirado, sem a lojista tocar em nada", async () => {
    await abrir(true);
    expect(cartaoDosAtivos()?.slice(1, 3)).toEqual(["2", "2"]);
    expect(selosDeExpirado()).toBe(0);

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s

    expect(cartaoDosAtivos()?.slice(1, 3)).toEqual(["1", "2"]);
    expect(selosDeExpirado()).toBeGreaterThan(0);
  });

  it("controle: sem virada de dia, o cupom segue ativo e contado", async () => {
    await abrir(true);
    await avancar(5_000);
    expect(cartaoDosAtivos()?.slice(1, 3)).toEqual(["2", "2"]);
    expect(selosDeExpirado()).toBe(0);
  });

  it("não relê os cupons no banco por causa da virada (só redesenha)", async () => {
    await abrir(true);
    const antes = refreshCoupons.mock.calls.length;
    await avancar(12_000);
    expect(refreshCoupons.mock.calls.length).toBe(antes);
  });

  it("tela inativa não arma relógio de virada (nada muda escondida)", async () => {
    await abrir(false);
    await avancar(12_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tela que abre já no dia seguinte mostra o cupom vencido de cara", async () => {
    vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
    await abrir(true);
    expect(cartaoDosAtivos()?.slice(1, 3)).toEqual(["1", "2"]);
  });
});
