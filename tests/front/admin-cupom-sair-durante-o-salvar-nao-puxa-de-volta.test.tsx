// @vitest-environment jsdom
//
// Sair do formulário de cupom durante o "Salvando…" (internet lenta): a
// gravação termina depois, com a lojista já em outra tela. Antes, o fim do
// salvar chamava `onNavigate("admin-coupons")` e a puxava de volta para a lista
// de cupons, e `onSetDirty(false)` apagava o aviso de "alterações não salvas"
// da tela em que ela estava. Mesmo padrão do formulário de produto (ADMIN-060):
// só navega quem ainda está montado.
import type { Coupon } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockCoupons: Coupon[] = [];
const updateCoupon = vi.fn();
const addCoupon = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ coupons: mockCoupons, addCoupon, updateCoupon }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendurada() {
  let resolver: (valor: unknown) => void = () => undefined;
  const promessa = new Promise<unknown>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("AdminCouponFormView — sair durante o salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();
  const onSetDirty = vi.fn();

  beforeEach(() => {
    updateCoupon.mockReset();
    addCoupon.mockReset();
    onNavigate.mockReset();
    onSetDirty.mockReset();
    mockCoupons = [
      {
        id: "c1",
        code: "VERAO10",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: true,
      },
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    mockCoupons = [];
  });

  async function abrirEditarESalvar() {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView
          couponId="c1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      (hospedeiro.querySelector("#coupon-active") as HTMLElement).click();
    });
    const salvar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Salvar Cupom"),
    ) as HTMLButtonElement;
    await act(async () => {
      salvar.click();
    });
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Salvando...");
  }

  it("a lojista saiu antes de a gravação terminar: não é puxada de volta e o aviso da outra tela fica", async () => {
    const gravacao = pendurada();
    updateCoupon.mockReturnValue(gravacao.promessa);
    await abrirEditarESalvar();

    // Ela sai do formulário (o roteador do painel desmonta a tela).
    await act(async () => {
      raiz.render(<div />);
    });
    onSetDirty.mockClear();

    await act(async () => {
      gravacao.resolver(undefined);
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSetDirty).not.toHaveBeenCalled();
  });

  it("controle: ainda na tela, o fim da gravação leva para a lista de cupons", async () => {
    const gravacao = pendurada();
    updateCoupon.mockReturnValue(gravacao.promessa);
    await abrirEditarESalvar();

    await act(async () => {
      gravacao.resolver(undefined);
    });

    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("admin-coupons");
  });
});
