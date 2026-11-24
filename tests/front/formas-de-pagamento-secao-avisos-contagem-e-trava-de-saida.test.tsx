// @vitest-environment jsdom
//
// FORMAS DE PAGAMENTO NA ENTREGA (secao do painel) — o que a lojista le e a
// trava de saida durante a gravacao. Renderiza `FormasDePagamentoSection`
// direto, so com o que ela recebe por props.
//
// O que protege (buracos achados por mutacao, 24/11/2026):
//  - enquanto grava, a secao avisa o painel que ha trabalho pendente
//    (`onDirtyMudou(true)`) e, ao terminar — com sucesso, recusa ou erro —
//    solta (`onDirtyMudou(false)`). Sem o `false`, o painel ficava para sempre
//    com "alteracoes nao salvas" e travava a saida da tela.
//  - o toast diz "ligado" quando ligou e "desligado" quando desligou, com o
//    nome da forma certa.
//  - a contagem "N forma(s) disponivel(is)" e o "Ligado/Desligado" de cada linha.
//  - o aviso de "nenhuma forma na entrega" so aparece com ZERO formas — com uma
//    so ligada a loja vende normalmente e o aviso seria um alarme falso.
//  - erro inesperado na gravacao vira toast de erro (e solta a trava).
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

// A secao importa o leitor do cartao, que importa o cliente do banco.
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfig = (
  updates: Partial<StoreConfig>,
  options?: { readonly silentSuccess?: boolean },
) => Promise<boolean>;

describe("FormasDePagamentoSection — avisos, contagem e trava de saida", () => {
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(
    formas: readonly FormaDePagamentoNaEntrega[],
    pixLigado = true,
  ) {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          cartaoPeloApp={<div data-testid="cartao-pelo-app" />}
          formasNaEntrega={formas}
          pixLigado={pixLigado}
          pixChaveOk={true}
          isOffline={false}
          updateConfig={updateConfig}
          onDirtyMudou={onDirtyMudou}
          onAbrirMercadoPago={() => {}}
        />,
      );
    });
  }

  function interruptor(rotulo: string): HTMLButtonElement {
    const alvo = hospedeiro.querySelector(
      `[role="switch"][aria-label="${rotulo}"]`,
    );
    if (!alvo) throw new Error(`O switch "${rotulo}" não está na tela.`);
    return alvo as HTMLButtonElement;
  }

  async function clicar(elemento: HTMLElement) {
    await act(async () => {
      elemento.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  function textoDaTela() {
    return hospedeiro.textContent ?? "";
  }

  describe("trava de saida (onDirtyMudou)", () => {
    it("grava com sucesso: avisa pendente (true) e depois solta (false), nessa ordem", async () => {
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor("Cartão na entrega ou retirada"));

      expect(onDirtyMudou.mock.calls).toEqual([[true], [false]]);
    });

    it("enquanto a gravacao nao termina, a secao fica pendente (true) e nao solta ainda", async () => {
      updateConfig.mockReturnValue(new Promise<boolean>(() => {}));
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor("Cartão na entrega ou retirada"));

      expect(onDirtyMudou.mock.calls).toEqual([[true]]);
    });

    it("gravacao nao confirmada (false): nao diz 'ligado/desligado' e solta a trava", async () => {
      updateConfig.mockResolvedValue(false);
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor("Cartão na entrega ou retirada"));

      expect(toastSucesso).not.toHaveBeenCalled();
      expect(onDirtyMudou.mock.calls).toEqual([[true], [false]]);
    });

    it("gravacao que lanca erro: toast de erro da secao e a trava e solta", async () => {
      updateConfig.mockRejectedValue(new Error("rede caiu"));
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor("Cartão na entrega ou retirada"));

      expect(toastErro).toHaveBeenCalledWith(
        "Erro ao atualizar a configuração",
      );
      expect(toastSucesso).not.toHaveBeenCalled();
      expect(onDirtyMudou.mock.calls).toEqual([[true], [false]]);
    });

    it("clique recusado pela regra da ultima forma nao liga a trava de saida", async () => {
      await montar(["cash"], false);
      await clicar(interruptor("Dinheiro na entrega ou retirada"));

      expect(updateConfig).not.toHaveBeenCalled();
      expect(onDirtyMudou).not.toHaveBeenCalled();
    });
  });

  describe("o toast diz o que aconteceu", () => {
    it("desligar uma forma diz 'desligado' com o nome dela", async () => {
      await montar(["pix", "card", "cash"]);
      await clicar(interruptor("Cartão na entrega ou retirada"));

      expect(toastSucesso).toHaveBeenCalledTimes(1);
      expect(toastSucesso).toHaveBeenCalledWith(
        "Cartão na entrega/retirada desligado",
      );
    });

    it("ligar uma forma diz 'ligado' com o nome dela", async () => {
      await montar(["pix"]);
      await clicar(interruptor("Dinheiro na entrega ou retirada"));

      expect(toastSucesso).toHaveBeenCalledTimes(1);
      expect(toastSucesso).toHaveBeenCalledWith(
        "Dinheiro na entrega/retirada ligado",
      );
    });
  });

  describe("o que a tela mostra", () => {
    it("conta no singular com UMA forma e no plural com 0, 2 e 3", async () => {
      await montar(["card"]);
      expect(textoDaTela()).toContain("1 forma disponível");
      expect(textoDaTela()).not.toContain("1 formas");

      await montar([]);
      expect(textoDaTela()).toContain("0 formas disponíveis");

      await montar(["pix", "cash"]);
      expect(textoDaTela()).toContain("2 formas disponíveis");

      await montar(["pix", "card", "cash"]);
      expect(textoDaTela()).toContain("3 formas disponíveis");
    });

    it("cada linha diz Ligado ou Desligado conforme a forma esta na lista", async () => {
      await montar(["card"]);
      const linhaDe = (rotulo: string) =>
        interruptor(rotulo).closest("label")?.textContent ?? "";

      expect(linhaDe("Pix na entrega ou retirada")).toContain("Desligado");
      expect(linhaDe("Cartão na entrega ou retirada")).toContain("Ligado");
      expect(linhaDe("Cartão na entrega ou retirada")).not.toContain(
        "Desligado",
      );
      expect(linhaDe("Dinheiro na entrega ou retirada")).toContain("Desligado");
    });

    it("o alarme de 'nenhuma forma na entrega' so aparece com ZERO formas", async () => {
      await montar(["cash"]);
      expect(textoDaTela()).not.toContain("Nenhuma forma na entrega");

      await montar(["pix", "card", "cash"]);
      expect(textoDaTela()).not.toContain("Nenhuma forma na entrega");

      await montar([]);
      expect(textoDaTela()).toContain("Nenhuma forma na entrega");
    });
  });
});
