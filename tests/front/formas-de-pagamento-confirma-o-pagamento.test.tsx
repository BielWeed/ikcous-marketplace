// @vitest-environment jsdom
//
// Loja pronta (27/11/2026, migration 20261652000000): a loja nova traz Pix,
// cartão e dinheiro na entrega ligados de fábrica, e o passo "recebe" do
// Início pede confirmação. Mexer num interruptor de Pagamentos também
// confirma — no MESMO pedido — mas só quando falta (`pagamentoConfirmado ===
// false`). Campo ausente (banco sem a coluna) nunca leva a chave.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormasDePagamentoSection } from "@/components/admin/settings/FormasDePagamentoCard";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import type { StoreConfig } from "@/types";

const { toastSucesso, toastErro } = vi.hoisted(() => ({
  toastSucesso: vi.fn<(msg: string) => void>(),
  toastErro: vi.fn<(msg: string) => void>(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn<() => unknown>(), rpc: vi.fn<() => unknown>() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfig = (
  updates: Partial<StoreConfig>,
  options?: {
    readonly silentSuccess?: boolean;
    readonly vistos?: { readonly formasPagamentoEntrega?: readonly string[] };
  },
) => Promise<boolean>;

describe("FormasDePagamentoSection — mexer nas formas confirma o pagamento da Loja pronta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const updateConfig = vi.fn<UpdateConfig>();

  beforeEach(() => {
    toastSucesso.mockReset();
    toastErro.mockReset();
    updateConfig.mockReset();
    updateConfig.mockResolvedValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(
    formas: readonly FormaDePagamentoNaEntrega[],
    pagamentoConfirmado: boolean | undefined,
    pixLigado = true,
  ) {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          cartaoPeloApp={<div />}
          formasNaEntrega={formas}
          pixLigado={pixLigado}
          pixChaveOk={pixLigado}
          isOffline={false}
          updateConfig={updateConfig}
          pagamentoConfirmado={pagamentoConfirmado}
          onAbrirMercadoPago={() => {}}
        />,
      );
    });
  }

  async function tocar(rotulo: string) {
    const el = hospedeiro.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${rotulo}"]`,
    );
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  it("loja nova (falta confirmar): desligar o Cartão grava a lista e confirma junto", async () => {
    await montar(["pix", "card", "cash"], false);
    await tocar("Cartão na entrega ou retirada");
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
      { formasPagamentoEntrega: ["pix", "cash"], pagamentoConfirmado: true },
      {
        silentSuccess: true,
        vistos: { formasPagamentoEntrega: ["pix", "card", "cash"] },
      },
    );
  });

  it.each([
    ["já confirmado", true],
    ["banco sem a coluna (campo ausente)", undefined],
  ])("%s: grava só a lista", async (_nome, confirmado) => {
    await montar(["pix"], confirmado);
    await tocar("Dinheiro na entrega ou retirada");
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true, vistos: { formasPagamentoEntrega: ["pix"] } },
    );
  });

  it("toque recusado antes da rede (última forma sem o app) não confirma nada", async () => {
    await montar(["pix"], false, false);
    await tocar("Pix na entrega ou retirada");
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
