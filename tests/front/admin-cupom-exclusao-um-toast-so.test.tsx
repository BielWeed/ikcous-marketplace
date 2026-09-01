// @vitest-environment jsdom
//
// Laudo 0109 (A-9) — `deleteCoupon` no hook JÁ faz toast de erro e DEPOIS
// lança (padrão da casa: o form não navega em erro). A view pegava o throw
// e toastava DE NOVO — a lojista via dois avisos empilhados para a mesma
// falha. O conserto: a view para de re-toastar; quem fala é o hook.
//
// O dublê do deleteCoupon reproduz o contrato real do hook
// (useCoupons.ts: toast de erro + throw), senão o teste não prova a
// interação — prova só que a tela calou.
//
// Montagem: mesmo casco de admin-coupons-view-expirado.test.tsx.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const deleteCoupon = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: mockCoupons,
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon,
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

function cupomFake(): Coupon {
  return {
    id: "cupom-1",
    code: "NATAL2026",
    type: "percentage",
    value: 10,
    usageCount: 0,
    active: true,
  };
}

describe("AdminCouponsView — excluir cupom falho dá UM toast só (laudo 0109, A-9)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    toastError.mockClear();
    deleteCoupon.mockReset();
    mockCoupons = [cupomFake()];
    // Contrato REAL do hook (useCoupons): o toast de erro sai DENTRO dele…
    deleteCoupon.mockImplementation(async () => {
      toastError("Erro ao remover cupom");
      // …e o throw é o que impede o form de seguir em frente.
      throw new Error("violates row-level security policy");
    });
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
    vi.unstubAllGlobals();
    mockCoupons = [];
  });

  async function abrirTela() {
    const { AdminCouponsView } = await import("@/views/admin/AdminCouponsView");
    await act(async () => {
      raiz.render(<AdminCouponsView active={true} onNavigate={vi.fn()} />);
    });
  }

  it("delete recusado: só o toast do hook — a tela não empilha o segundo", async () => {
    await abrirTela();

    // O botão da lixeira (lucide Trash) abre a confirmação.
    const lixeira = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.querySelector('svg[class*="lucide-trash"]'),
    );
    expect(lixeira).toBeTruthy();
    await act(async () => {
      lixeira!.click();
    });

    // AlertDialog de confirmação: o botão "Excluir Cupom" dispara o fluxo.
    const confirmar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Excluir Cupom",
    );
    expect(confirmar).toBeTruthy();

    await act(async () => {
      confirmar!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteCoupon).toHaveBeenCalledWith("cupom-1");
    // O ponto do A-9: o hook falou UMA vez; com o defeito a tela falava a
    // segunda ("Erro ao excluir o cupom."), empilhada por cima.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Erro ao remover cupom");
  });

  it("controle — delete que funciona: nenhum toast de erro", async () => {
    deleteCoupon.mockResolvedValue(undefined);

    await abrirTela();
    const lixeira = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.querySelector('svg[class*="lucide-trash"]'),
    );
    await act(async () => {
      lixeira!.click();
    });
    const confirmar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Excluir Cupom",
    );
    await act(async () => {
      confirmar!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalled();
  });
});
