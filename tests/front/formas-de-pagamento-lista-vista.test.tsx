// @vitest-environment jsdom
//
// Caça 27/11 — formas de pagamento na entrega em dois aparelhos. Cada
// interruptor grava a lista INTEIRA, montada da cópia que a tela tem. O
// celular com a tela velha (só Pix) ligava o Dinheiro e gravava Pix+Dinheiro
// por cima do Cartão que o computador tinha acabado de ligar. Agora o
// interruptor diz ao `updateConfig` qual lista ele VIU — exatamente a que
// estava na tela, na ordem em que veio — e o banco recusa se ela já mudou
// (o aviso e a releitura saem de dentro do `updateConfig`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormasDePagamentoSection } from "@/components/admin/settings/FormasDePagamentoCard";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import type { StoreConfig } from "@/types";

const { toastSucesso, toastErro } = vi.hoisted(() => ({
  toastSucesso: vi.fn(),
  toastErro: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
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

describe("FormasDePagamentoSection — manda a lista que viu", () => {
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

  async function montar(formas: readonly FormaDePagamentoNaEntrega[]) {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          cartaoPeloApp={<div />}
          formasNaEntrega={formas}
          pixLigado={true}
          pixChaveOk={true}
          isOffline={false}
          updateConfig={updateConfig}
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

  it("ligar o Dinheiro com só o Pix na tela manda a lista vista [pix]", async () => {
    await montar(["pix"]);
    await tocar("Dinheiro na entrega ou retirada");
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true, vistos: { formasPagamentoEntrega: ["pix"] } },
    );
  });

  it("desligar o Cartão manda a lista vista inteira, na ordem em que veio do banco", async () => {
    await montar(["cash", "card", "pix"]);
    await tocar("Cartão na entrega ou retirada");
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
      { formasPagamentoEntrega: ["cash", "pix"] },
      {
        silentSuccess: true,
        vistos: { formasPagamentoEntrega: ["cash", "card", "pix"] },
      },
    );
  });

  it("a recusa (outro aparelho mudou) não mostra o 'ligado' de sucesso", async () => {
    updateConfig.mockResolvedValue(false);
    await montar(["pix"]);
    await tocar("Dinheiro na entrega ou retirada");
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastSucesso).not.toHaveBeenCalled();
  });
});
