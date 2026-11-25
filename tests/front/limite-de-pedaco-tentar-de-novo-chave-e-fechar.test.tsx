// @vitest-environment jsdom
//
// LimiteDePedaco: o limite de erro de UM pedaço carregado sob demanda (folha,
// leitor, seção do painel). Hoje só é provado por tabela, dentro de telas
// grandes. Aqui o próprio limite, nos pontos em que ele erra sem ninguém ver:
//   - "Tentar de novo" pede CADA pedaço outra vez (um pedaço não pedido de novo
//     é um download que nunca se refaz) e volta a desenhar os filhos;
//   - sem a lista de pedaços, só desenha de novo (e não quebra);
//   - se o filho continua falhando, volta ao aviso — sem laço;
//   - `resetKey` só dispara a nova tentativa com o pedaço JÁ falhado e só
//     quando o valor MUDA (mexer em `resetKey` com tudo bem não pede nada);
//   - "Fechar" só existe quando quem abriu deu `aoFechar`, e fechar não conta
//     como nova tentativa;
//   - `fallback` próprio troca o aviso padrão e recebe a mesma ação.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LimiteDePedaco } from "@/components/ui/custom/LimiteDePedaco";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LimiteDePedaco — tentar de novo, chave de reinício e fechar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let falha = true;

  function Bomba() {
    if (falha) throw new Error("pedaço não baixou");
    return <p>conteúdo do pedaço</p>;
  }

  beforeEach(() => {
    falha = true;
    // O React e o limite avisam a falha no console; aqui é esperado.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  const texto = () => hospedeiro.textContent ?? "";
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === rotulo,
    );

  function montar(props: {
    pedacos?: readonly { tentarDeNovo: () => void }[];
    fallback?: (acoes: { tentarDeNovo: () => void }) => ReactNode;
    aoFechar?: () => void;
    resetKey?: unknown;
  }) {
    act(() => {
      raiz.render(
        <LimiteDePedaco {...props}>
          <Bomba />
        </LimiteDePedaco>,
      );
    });
  }

  it("sem falha: desenha os filhos e nenhum aviso", () => {
    falha = false;
    montar({});
    expect(texto()).toContain("conteúdo do pedaço");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("com falha: aviso curto de painel, sem 'Fechar' quando ninguém deu aoFechar", () => {
    montar({});
    const aviso = hospedeiro.querySelector('[role="alert"]');
    expect(aviso?.textContent).toContain("Esta parte não abriu.");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(botao("Fechar")).toBeUndefined();
    expect(texto()).not.toContain("conteúdo do pedaço");
  });

  it("registra o motivo no console (aviso, não erro de tela)", () => {
    montar({});
    expect(console.warn).toHaveBeenCalledWith(
      "[LimiteDePedaco] pedaço não abriu:",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("Tentar de novo pede CADA pedaço uma vez e redesenha o filho quando a falha passou", () => {
    const a = vi.fn();
    const b = vi.fn();
    montar({ pedacos: [{ tentarDeNovo: a }, { tentarDeNovo: b }] });
    falha = false;
    act(() => {
      botao("Tentar de novo")?.click();
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("conteúdo do pedaço");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("sem lista de pedaços: Tentar de novo só desenha de novo, sem quebrar", () => {
    montar({});
    falha = false;
    act(() => {
      botao("Tentar de novo")?.click();
    });
    expect(texto()).toContain("conteúdo do pedaço");
  });

  it("se o filho segue falhando, volta ao aviso (e dá para tentar outra vez)", () => {
    const a = vi.fn();
    montar({ pedacos: [{ tentarDeNovo: a }] });
    act(() => {
      botao("Tentar de novo")?.click();
    });
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    act(() => {
      botao("Tentar de novo")?.click();
    });
    expect(a).toHaveBeenCalledTimes(2);
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
  });

  describe("resetKey", () => {
    it("com o pedaço falhado, mudar a chave tenta de novo sozinho (e pede os pedaços)", () => {
      const a = vi.fn();
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: "link-1" });
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
      falha = false;
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: "link-2" });
      expect(a).toHaveBeenCalledTimes(1);
      expect(texto()).toContain("conteúdo do pedaço");
    });

    it("com o pedaço falhado, a MESMA chave não tenta de novo", () => {
      const a = vi.fn();
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: "link-1" });
      falha = false;
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: "link-1" });
      expect(a).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    });

    it("sem falha, mudar a chave não pede pedaço nenhum", () => {
      falha = false;
      const a = vi.fn();
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: 1 });
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: 2 });
      expect(a).not.toHaveBeenCalled();
      expect(texto()).toContain("conteúdo do pedaço");
    });

    it("chave nova e o filho ainda falha: volta ao aviso, sem laço", () => {
      const a = vi.fn();
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: 1 });
      montar({ pedacos: [{ tentarDeNovo: a }], resetKey: 2 });
      expect(a).toHaveBeenCalledTimes(1);
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    });
  });

  describe("Fechar (pedaço que abre por cima da tela)", () => {
    it("com aoFechar o aviso ganha 'Fechar', que chama aoFechar e NÃO tenta de novo", () => {
      const aoFechar = vi.fn();
      const a = vi.fn();
      montar({ aoFechar, pedacos: [{ tentarDeNovo: a }] });
      act(() => {
        botao("Fechar")?.click();
      });
      expect(aoFechar).toHaveBeenCalledTimes(1);
      expect(a).not.toHaveBeenCalled();
    });

    it("'Tentar de novo' não fecha", () => {
      const aoFechar = vi.fn();
      montar({ aoFechar });
      act(() => {
        botao("Tentar de novo")?.click();
      });
      expect(aoFechar).not.toHaveBeenCalled();
    });
  });

  describe("fallback próprio", () => {
    it("troca o aviso padrão e a ação que recebe refaz a tentativa", () => {
      const a = vi.fn();
      montar({
        pedacos: [{ tentarDeNovo: a }],
        aoFechar: () => {},
        fallback: ({ tentarDeNovo }) => (
          <button type="button" onClick={tentarDeNovo}>
            De novo, por favor
          </button>
        ),
      });
      expect(texto()).not.toContain("Esta parte não abriu.");
      expect(botao("Fechar")).toBeUndefined();
      falha = false;
      act(() => {
        botao("De novo, por favor")?.click();
      });
      expect(a).toHaveBeenCalledTimes(1);
      expect(texto()).toContain("conteúdo do pedaço");
    });
  });
});
