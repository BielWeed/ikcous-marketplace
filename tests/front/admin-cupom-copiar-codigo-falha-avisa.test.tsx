// @vitest-environment jsdom
//
// Laudo 0109 (A-8) — o código do cupom era "copiado" com
// `navigator.clipboard.writeText(code)` sem await/catch: a tela mostrava
// `Código "X" copiado!` mesmo quando a cópia falhava. Com o util
// `copiarParaClipboard`, só comemora com `true`; com `false`, avisa.
//
// Montagem: mesmo casco de admin-coupons-view-expirado.test.tsx.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let clipboardWriteText: (texto: string) => Promise<void> = vi
  .fn()
  .mockResolvedValue(undefined);

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
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
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

let mockCoupons: Coupon[] = [];

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cupomFake(overrides: Partial<Coupon>): Coupon {
  return {
    id: "cupom-1",
    code: "NATAL2026",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
    ...overrides,
  };
}

describe("AdminCouponsView — copiar código não finge sucesso (laudo 0109, A-8)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Os mocks do sonner são do módulo (compartilhados entre os testes
    // deste arquivo) — limpa as chamadas do teste anterior antes de tudo.
    vi.clearAllMocks();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: (...args: Parameters<typeof clipboardWriteText>) =>
          clipboardWriteText(...args),
      },
      configurable: true,
    });
    mockCoupons = [cupomFake({})];
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
    Reflect.deleteProperty(window.navigator, "clipboard");
    vi.unstubAllGlobals();
    mockCoupons = [];
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  function botaoCopiarCodigo() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Copiar Código",
    );
  }

  it("clipboard recusa: toast de erro, nenhum toast de sucesso, check de 'copiado' não acende", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await abrirTela();

    const botao = botaoCopiarCodigo();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith("Não foi possível copiar.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("clipboard aceita: toast de sucesso com o código (controle)", async () => {
    await abrirTela();

    const botao = botaoCopiarCodigo();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).toHaveBeenCalledWith('Código "NATAL2026" copiado!');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
