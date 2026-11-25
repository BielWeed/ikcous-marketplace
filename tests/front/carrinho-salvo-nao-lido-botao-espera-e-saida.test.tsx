// @vitest-environment jsdom
//
// CarrinhoSalvoNaoLido: a tela que aparece quando o carrinho salvo da conta não
// carregou (lista vazia ali NÃO é carrinho vazio). A lógica própria dela é o
// botão "Tentar de novo":
//   - enquanto a releitura está em andamento o botão diz "Tentando…" e fica
//     desligado — um segundo toque NÃO pede outra releitura em paralelo;
//   - terminada a releitura (devolva ou não uma promessa) o botão volta;
//   - "sair" é um caminho de verdade, com o rótulo que quem usa deu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CarrinhoSalvoNaoLido } from "@/components/ui/custom/CarrinhoSalvoNaoLido";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CarrinhoSalvoNaoLido — botão de tentar de novo e saída", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === rotulo,
    );

  function montar(
    onTentarDeNovo: () => Promise<void> | void,
    onSair: () => void = () => {},
  ) {
    act(() => {
      raiz.render(
        <CarrinhoSalvoNaoLido
          onTentarDeNovo={onTentarDeNovo}
          onSair={onSair}
          rotuloDoSair="Voltar para a loja"
        />,
      );
    });
  }

  it("diz que não conseguiu carregar (e não que o carrinho está vazio)", () => {
    montar(() => {});
    const aviso = hospedeiro.querySelector('[role="status"]');
    expect(aviso?.textContent).toContain("Não conseguimos carregar");
    expect(aviso?.textContent).not.toMatch(/vazio/i);
  });

  it("o botão de sair tem o rótulo dado e chama onSair uma vez, sem reler o carrinho", () => {
    const sair = vi.fn();
    const reler = vi.fn();
    montar(reler, sair);
    act(() => {
      botao("Voltar para a loja")?.click();
    });
    expect(sair).toHaveBeenCalledTimes(1);
    expect(reler).not.toHaveBeenCalled();
  });

  it("em andamento: 'Tentando…' e desligado; um segundo toque não relê em paralelo; ao terminar, volta", async () => {
    let terminar: () => void = () => {};
    const reler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    montar(reler);

    expect(botao("Tentar de novo")?.disabled).toBe(false);
    await act(async () => {
      botao("Tentar de novo")?.click();
    });

    const andando = botao("Tentando…");
    expect(andando).toBeDefined();
    expect(andando?.disabled).toBe(true);
    expect(botao("Tentar de novo")).toBeUndefined();

    await act(async () => {
      andando?.click();
    });
    expect(reler).toHaveBeenCalledTimes(1);

    await act(async () => {
      terminar();
    });
    expect(botao("Tentando…")).toBeUndefined();
    expect(botao("Tentar de novo")?.disabled).toBe(false);

    // E dá para tentar de novo depois: uma nova releitura, não a velha.
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(reler).toHaveBeenCalledTimes(2);
  });

  it("releitura que devolve sem promessa também volta o botão", async () => {
    const reler = vi.fn();
    montar(reler);
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(reler).toHaveBeenCalledTimes(1);
    expect(botao("Tentar de novo")?.disabled).toBe(false);
    expect(botao("Tentando…")).toBeUndefined();
  });
});
