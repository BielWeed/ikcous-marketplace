// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em FormasDePagamentoSection (os testes
// antigos passavam mesmo com o defeito de uma linha plantado):
//  - sem o pagamento pelo app, desligar uma forma na entrega é permitido
//    enquanto sobrar outra; só a ÚLTIMA é recusada (a loja ficaria sem forma
//    nenhuma) — e com o pagamento pelo app ligado a última pode sair;
//  - a lista gravada segue a ordem de fábrica (pix, cartão, dinheiro), nunca a
//    ordem em que a lojista tocou os interruptores;
//  - sem internet nada é gravado e a trava de saída não é acionada.
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
  options?: { readonly silentSuccess?: boolean },
) => Promise<boolean>;

const ULTIMA_FORMA =
  "Não dá para desligar a última forma sem o pagamento pelo app ligado. Ligue o Pix pelo app antes, ou deixe ao menos uma forma na entrega.";

describe("FormasDePagamentoSection (buracos de mutação)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onDirtyMudou = vi.fn<(dirty: boolean) => void>();
  const updateConfig = vi.fn<UpdateConfig>();

  beforeEach(() => {
    toastSucesso.mockReset();
    toastErro.mockReset();
    onDirtyMudou.mockReset();
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
    opcoes: { pixLigado?: boolean; isOffline?: boolean } = {},
  ) {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          cartaoPeloApp={<div />}
          formasNaEntrega={formas}
          pixLigado={opcoes.pixLigado ?? true}
          pixChaveOk={true}
          isOffline={opcoes.isOffline ?? false}
          updateConfig={updateConfig}
          onDirtyMudou={onDirtyMudou}
          onAbrirMercadoPago={() => {}}
        />,
      );
    });
  }

  const interruptor = (rotulo: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${rotulo}"]`,
    ) as HTMLButtonElement;

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  const CARTAO = "Cartão na entrega ou retirada";
  const PIX = "Pix na entrega ou retirada";
  const DINHEIRO = "Dinheiro na entrega ou retirada";

  describe("regra da última forma", () => {
    it("sem pagamento pelo app, desligar uma forma com outra sobrando é permitido", async () => {
      await montar(["pix", "card"], { pixLigado: false });
      await clicar(interruptor(CARTAO));
      expect(toastErro).not.toHaveBeenCalled();
      expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
        { formasPagamentoEntrega: ["pix"] },
        { silentSuccess: true },
      );
      expect(toastSucesso).toHaveBeenCalledWith(
        "Cartão na entrega/retirada desligado",
      );
    });

    it("sem pagamento pelo app, desligar a ÚLTIMA forma é recusado antes de gastar a chamada", async () => {
      await montar(["cash"], { pixLigado: false });
      await clicar(interruptor(DINHEIRO));
      expect(toastErro).toHaveBeenCalledExactlyOnceWith(ULTIMA_FORMA);
      expect(updateConfig).not.toHaveBeenCalled();
      expect(onDirtyMudou).not.toHaveBeenCalled();
    });

    it("com pagamento pelo app ligado, desligar a última forma é permitido", async () => {
      await montar(["cash"], { pixLigado: true });
      await clicar(interruptor(DINHEIRO));
      expect(toastErro).not.toHaveBeenCalled();
      expect(updateConfig).toHaveBeenCalledExactlyOnceWith(
        { formasPagamentoEntrega: [] },
        { silentSuccess: true },
      );
    });

    it("sem pagamento pelo app, LIGAR uma forma nunca é recusado", async () => {
      await montar(["cash"], { pixLigado: false });
      await clicar(interruptor(PIX));
      expect(toastErro).not.toHaveBeenCalled();
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe("ordem da lista gravada", () => {
    it("ligar o Pix com dinheiro já ligado grava pix antes de dinheiro", async () => {
      await montar(["cash"]);
      await clicar(interruptor(PIX));
      expect(updateConfig).toHaveBeenCalledWith(
        { formasPagamentoEntrega: ["pix", "cash"] },
        { silentSuccess: true },
      );
    });

    it("ligar o Cartão com a lista em outra ordem grava na ordem de fábrica", async () => {
      await montar(["cash", "pix"]);
      await clicar(interruptor(CARTAO));
      expect(updateConfig).toHaveBeenCalledWith(
        { formasPagamentoEntrega: ["pix", "card", "cash"] },
        { silentSuccess: true },
      );
    });

    it("desligar uma forma mantém a ordem das que sobram", async () => {
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor(CARTAO));
      expect(updateConfig).toHaveBeenCalledWith(
        { formasPagamentoEntrega: ["pix", "cash"] },
        { silentSuccess: true },
      );
    });
  });

  describe("sem internet", () => {
    it("não grava, avisa que está offline e não aciona a trava de saída", async () => {
      await montar(["pix", "card", "cash"], { isOffline: true });
      await clicar(interruptor(CARTAO));
      expect(toastErro).toHaveBeenCalledExactlyOnceWith("Você está offline");
      expect(updateConfig).not.toHaveBeenCalled();
      expect(onDirtyMudou).not.toHaveBeenCalled();
      expect(toastSucesso).not.toHaveBeenCalled();
    });
  });
});
