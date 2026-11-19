// @vitest-environment jsdom
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteCoupon = vi.fn<(id: string) => Promise<void>>();
const coupons: Coupon[] = ["PRIMEIRO", "SEGUNDO"].map((code) => ({
  id: code,
  code,
  type: "percentage",
  value: 10,
  usageCount: 0,
  active: true,
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons,
    loading: false,
    deleteCoupon,
    refreshCoupons: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableCoupons: true }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminCouponsView — exclusão pendente por cupom", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    deleteCoupon.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lixeira(codigo: string) {
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="Excluir cupom ${codigo}"]`,
    );
    if (!botao) throw new Error(`Lixeira não encontrada: ${codigo}`);
    return botao;
  }

  function confirmar() {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Excluir cupom",
    );
    if (!botao) throw new Error("Confirmação de exclusão não encontrada");
    botao.click();
  }

  it.each(["sucesso", "erro"])(
    "bloqueia apenas o cupom pendente e libera a lixeira após %s",
    async (resultado) => {
      let concluir!: () => void;
      let falhar!: (erro: Error) => void;
      const pendente = new Promise<void>((resolve, reject) => {
        concluir = resolve;
        falhar = reject;
      });
      deleteCoupon.mockResolvedValue(undefined);
      deleteCoupon.mockReturnValueOnce(pendente);
      if (resultado === "erro") {
        vi.spyOn(console, "error").mockImplementation(() => {});
      }

      const { AdminCouponsView } = await import(
        "@/views/admin/AdminCouponsView"
      );
      await act(async () => {
        raiz.render(<AdminCouponsView active onNavigate={vi.fn()} />);
      });

      await act(async () => lixeira("PRIMEIRO").click());
      await act(async () => confirmar());
      expect(deleteCoupon.mock.calls).toEqual([["PRIMEIRO"]]);

      expect(lixeira("PRIMEIRO").disabled).toBe(true);
      expect(lixeira("PRIMEIRO").getAttribute("aria-disabled")).toBe("true");
      await act(async () => lixeira("PRIMEIRO").click());
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(deleteCoupon.mock.calls).toEqual([["PRIMEIRO"]]);

      expect(lixeira("SEGUNDO").disabled).toBe(false);
      await act(async () => lixeira("SEGUNDO").click());
      await act(async () => confirmar());
      expect(deleteCoupon.mock.calls).toEqual([["PRIMEIRO"], ["SEGUNDO"]]);

      // O dublê conserva o cartão para podermos observar a liberação da trava.
      await act(async () => {
        if (resultado === "sucesso") concluir();
        else falhar(new Error("Falha simulada de exclusão"));
      });
      expect(lixeira("PRIMEIRO").disabled).toBe(false);
      expect(lixeira("PRIMEIRO").getAttribute("aria-disabled")).toBe("false");
    },
  );
});
