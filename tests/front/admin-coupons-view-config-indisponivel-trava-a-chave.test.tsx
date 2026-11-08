// @vitest-environment jsdom
//
// CUPONS COM A LEITURA DA LOJA FALHA (lote r64-g, 07/11/2026).
//
// Sem leitura e sem cópia no aparelho, `config` é a de fábrica
// (`enableCoupons: true`) e a chave geral "Cupons de Desconto" aparecia como o
// estado REAL da loja, ligada para o toque. Cupom é dinheiro: ligar ou
// desligar a chave às cegas muda o checkout de todos os clientes. Com a leitura
// falha a tela avisa e trava a chave; com a config carregada nada muda. A
// chavinha de cada cupom é outra coisa (mora na tabela de cupons) e não entra.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: { enableCoupons: true } as { enableCoupons: boolean },
  // `undefined` imita o contexto antigo (dublê sem o campo).
  configIndisponivel: undefined as boolean | undefined,
  updateConfig: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [
      {
        id: "a",
        code: "UM",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: true,
      } satisfies Coupon,
    ],
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    isLoaded: true,
    updateConfig: estado.updateConfig,
    refresh: estado.refresh,
    configIndisponivel: estado.configIndisponivel,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminCouponsView — leitura da loja falha (configIndisponivel)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    estado.config = { enableCoupons: true };
    estado.configIndisponivel = undefined;
    estado.updateConfig.mockReset().mockResolvedValue(true);
    estado.refresh.mockReset().mockResolvedValue(undefined);
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
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  const chave = () =>
    hospedeiro.querySelector<HTMLButtonElement>("#enable-coupons-switch");
  const aviso = () =>
    hospedeiro.querySelector<HTMLElement>("[data-aviso-loja-sem-dados]");

  it("leitura falha: mostra o aviso e trava a chave geral; nada é gravado", async () => {
    estado.configIndisponivel = true;
    await abrirTela();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Não foi possível carregar os dados da loja",
    );
    expect(chave()).not.toBeNull();
    expect(chave()?.disabled).toBe(true);

    await act(async () => chave()?.click());
    expect(estado.updateConfig).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' do aviso relê só a configuração", async () => {
    estado.configIndisponivel = true;
    await abrirTela();
    const tentar = [...(aviso()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());

    expect(estado.refresh).toHaveBeenCalledTimes(1);
    expect(estado.refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it.each([
    ["false", false],
    ["ausente (contexto antigo)", undefined],
  ] as const)(
    "configIndisponivel %s: sem aviso e a chave grava como sempre",
    async (_nome, valor) => {
      estado.configIndisponivel = valor;
      await abrirTela();

      expect(aviso()).toBeNull();
      expect(chave()?.disabled).toBe(false);
      await act(async () => chave()?.click());

      expect(estado.updateConfig).toHaveBeenCalledTimes(1);
      expect(estado.updateConfig).toHaveBeenCalledWith(
        { enableCoupons: false },
        { silentSuccess: true },
      );
      expect(estado.refresh).not.toHaveBeenCalled();
    },
  );
});
