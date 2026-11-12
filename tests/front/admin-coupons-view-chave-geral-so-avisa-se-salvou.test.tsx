// @vitest-environment jsdom
//
// CHAVE GERAL "CUPONS DE DESCONTO" (lote r130-c). Ela liga/desliga o cupom no
// checkout de TODOS os clientes, então a tela não pode mentir sobre o resultado:
//   - `updateConfig` devolveu false (falha, prazo, conta rebaixada, resposta
//     velha): nada de toast verde "desativados no aplicativo", porque a loja
//     continua com desconto;
//   - dois toques seguidos gravam UMA vez só, com a chave travada em
//     "Salvando...", para não gravar em ordem trocada;
//   - `updateConfig` que lança: aviso vermelho e a trava solta (novo toque
//     tenta de novo).
// O vizinho (admin-coupons-view-config-indisponivel-trava-a-chave) só usa
// `updateConfig` feliz e nunca inspeciona o toast.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: { enableCoupons: true } as { enableCoupons: boolean },
  updateConfig: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
    refresh: vi.fn(),
    configIndisponivel: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: estado.toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminCouponsView — chave geral só avisa o que foi gravado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let erroNoConsole: ReturnType<typeof vi.spyOn>;

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
    // O `catch` do componente registra o erro no console; o teste do erro
    // lançado não deve poluir a saída.
    erroNoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.config = { enableCoupons: true };
    estado.updateConfig.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    erroNoConsole.mockRestore();
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

  it("updateConfig devolveu false: nenhum toast de sucesso", async () => {
    estado.updateConfig.mockResolvedValue(false);
    await abrirTela();

    await act(async () => chave()?.click());

    expect(estado.updateConfig).toHaveBeenCalledTimes(1);
    expect(estado.updateConfig).toHaveBeenCalledWith(
      { enableCoupons: false },
      { silentSuccess: true },
    );
    expect(estado.toast.success).not.toHaveBeenCalled();
    expect(estado.toast.error).not.toHaveBeenCalled();
    // A trava solta mesmo sem sucesso: a lojista pode tentar de novo.
    expect(chave()?.disabled).toBe(false);
  });

  it("updateConfig devolveu true: o toast de sucesso é o da direção certa", async () => {
    estado.updateConfig.mockResolvedValue(true);
    await abrirTela();

    await act(async () => chave()?.click());

    expect(estado.toast.success).toHaveBeenCalledExactlyOnceWith(
      "Cupons de desconto desativados no aplicativo",
    );
  });

  it("dois toques com a gravação no ar: grava UMA vez e a chave fica em 'Salvando...'", async () => {
    let terminar!: (salvou: boolean) => void;
    estado.updateConfig.mockReturnValue(
      new Promise<boolean>((resolve) => {
        terminar = resolve;
      }),
    );
    await abrirTela();

    // Os dois toques no MESMO lote: o React ainda não redesenhou a chave como
    // desabilitada, então só a trava por ref segura o segundo.
    await act(async () => {
      chave()?.click();
      chave()?.click();
    });

    expect(estado.updateConfig).toHaveBeenCalledTimes(1);
    expect(chave()?.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Salvando...");

    // Terceiro toque, já com a tela redesenhada: continua sem gravar.
    await act(async () => chave()?.click());
    expect(estado.updateConfig).toHaveBeenCalledTimes(1);

    await act(async () => terminar(true));
    expect(chave()?.disabled).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Salvando...");
    expect(estado.toast.success).toHaveBeenCalledTimes(1);
  });

  it("updateConfig lançando: toast de erro e a trava solta (novo toque grava de novo)", async () => {
    estado.updateConfig.mockRejectedValueOnce(new Error("rede caiu"));
    await abrirTela();

    await act(async () => chave()?.click());

    expect(estado.toast.error).toHaveBeenCalledExactlyOnceWith(
      "Erro ao atualizar a configuração",
    );
    expect(estado.toast.success).not.toHaveBeenCalled();
    expect(chave()?.disabled).toBe(false);

    estado.updateConfig.mockResolvedValueOnce(true);
    await act(async () => chave()?.click());
    expect(estado.updateConfig).toHaveBeenCalledTimes(2);
  });
});
