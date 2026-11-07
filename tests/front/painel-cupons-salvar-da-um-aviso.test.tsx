// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  sucesso: vi.fn(),
  erro: vi.fn(),
  falhar: false,
}));

vi.mock("sonner", () => ({
  toast: { success: estado.sucesso, error: estado.erro },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [],
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    // Contrato de StoreContext.updateConfig: erro continua falando,
    // silentSuccess cala apenas o sucesso genérico, não a frase da tela.
    updateConfig: async (
      _mudancas: unknown,
      opcoes?: { silentSuccess?: boolean },
    ) => {
      if (estado.falhar) {
        estado.erro("Erro ao salvar configurações");
        return false;
      }
      if (!opcoes?.silentSuccess) estado.sucesso("Configurações salvas");
      return true;
    },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  estado.falhar = false;
});

describe("interruptor geral de cupons", () => {
  async function alternar() {
    const observador = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.stubGlobal("ResizeObserver", observador);
    vi.stubGlobal("IntersectionObserver", observador);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    try {
      const { AdminCouponsView } = await import(
        "@/views/admin/AdminCouponsView"
      );
      await act(async () => {
        raiz.render(<AdminCouponsView onNavigate={vi.fn()} />);
      });
      const interruptor = hospedeiro.querySelector<HTMLButtonElement>(
        "#enable-coupons-switch",
      );
      expect(interruptor).not.toBeNull();
      await act(async () => {
        interruptor!.click();
      });
    } finally {
      act(() => raiz.unmount());
      hospedeiro.remove();
    }
  }

  it("confirma uma vez, com a frase que diz o que mudou", async () => {
    await alternar();
    expect(estado.sucesso).toHaveBeenCalledTimes(1);
    expect(estado.sucesso).toHaveBeenCalledWith(
      "Cupons de desconto desativados no aplicativo",
    );
    expect(estado.erro).not.toHaveBeenCalled();
  });

  it("falha continua anunciada pelo contexto, sem sucesso falso", async () => {
    estado.falhar = true;
    await alternar();
    expect(estado.sucesso).not.toHaveBeenCalled();
    expect(estado.erro).toHaveBeenCalledTimes(1);
  });
});
