// @vitest-environment jsdom
//
// `useCamadaDeTelaCheia` em si, com uma camada mínima: as FRONTEIRAS do teclado
// que o teste das duas camadas reais (ImageAdjuster, PhoneSimulator) não via --
// cada uma sobrevivia à remoção do ramo (caçada por mutação, 24/11/2026).
//   - Esc já tratado por um componente de dentro (defaultPrevented) NÃO fecha.
//   - Esc tratado: o evento é cancelado (o navegador não faz mais nada com ele).
//   - Camada SEM nenhum campo focável: o Tab é cancelado e o foco vai à raiz.
//   - Foco na própria raiz: Tab vai ao primeiro, Shift+Tab ao último; foco
//     fora da camada: idem.
//   - Foco no meio da lista: o Tab anda sozinho (não é cancelado).
//   - Só focável de verdade entra na lista (tabindex="0" entra, "-1" e botão
//     desabilitado não).
//   - Outras teclas passam intactas.
//   - `aoFechar`/`podeFechar` novos valem no Esc seguinte (sem reabrir).
//   - `ativa=false`: nada de foco, de Esc nem de Tab preso; ao desligar
//     depois de ativa, o foco volta a quem abriu e o Esc solta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCamadaDeTelaCheia } from "@/hooks/useCamadaDeTelaCheia";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Props {
  readonly aoFechar: () => void;
  readonly podeFechar?: boolean;
  readonly ativa?: boolean;
  readonly children?: React.ReactNode;
  readonly aoTeclarDentro?: (e: React.KeyboardEvent) => void;
}

function Camada({
  aoFechar,
  podeFechar = true,
  ativa = true,
  children,
  aoTeclarDentro,
}: Props) {
  const raiz = useCamadaDeTelaCheia<HTMLDivElement>(
    aoFechar,
    podeFechar,
    ativa,
  );
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- o ouvinte imita um componente de dentro (ex.: Radix) que já tratou a tecla
    <div
      ref={raiz}
      role="dialog"
      aria-modal="true"
      aria-label="Camada"
      tabIndex={-1}
      data-testid="camada"
      onKeyDown={aoTeclarDentro}
    >
      {children}
    </div>
  );
}

const TRES_BOTOES = (
  <>
    <button type="button">um</button>
    <button type="button">dois</button>
    <button type="button">tres</button>
  </>
);

describe("useCamadaDeTelaCheia — fronteiras do teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let origem: HTMLButtonElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    origem = document.createElement("button");
    origem.textContent = "origem";
    document.body.appendChild(origem);
    origem.focus();
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    origem.remove();
  });

  const montar = (props: Props) =>
    act(() => {
      raiz.render(<Camada {...props} />);
    });

  const camada = () =>
    document.body.querySelector<HTMLElement>('[data-testid="camada"]');

  const botao = (nome: string) =>
    [...document.body.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent === nome,
    ) as HTMLElement;

  const teclar = (key: string, opcoes: { shiftKey?: boolean } = {}) => {
    const evento = new KeyboardEvent("keydown", {
      key,
      shiftKey: opcoes.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(evento);
    });
    return evento;
  };

  describe("Esc", () => {
    it("já tratado por um componente de dentro (defaultPrevented): não fecha a camada", () => {
      const aoFechar = vi.fn<() => void>();
      montar({
        aoFechar,
        aoTeclarDentro: (e) => e.preventDefault(),
        children: TRES_BOTOES,
      });
      botao("um").focus();
      teclar("Escape");
      expect(aoFechar).not.toHaveBeenCalled();
    });

    it("tratado pela camada: o evento é cancelado e fecha uma vez", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, children: TRES_BOTOES });
      const evento = teclar("Escape");
      expect(evento.defaultPrevented).toBe(true);
      expect(aoFechar).toHaveBeenCalledTimes(1);
    });

    it("com podeFechar=false o Esc é engolido: cancelado, mas não fecha", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, podeFechar: false, children: TRES_BOTOES });
      const evento = teclar("Escape");
      expect(evento.defaultPrevented).toBe(true);
      expect(aoFechar).not.toHaveBeenCalled();
    });

    it("aoFechar e podeFechar novos valem no Esc seguinte, sem reabrir a camada", () => {
      const velho = vi.fn<() => void>();
      const novo = vi.fn<() => void>();
      montar({ aoFechar: velho, children: TRES_BOTOES });
      montar({ aoFechar: novo, children: TRES_BOTOES });
      teclar("Escape");
      expect(velho).not.toHaveBeenCalled();
      expect(novo).toHaveBeenCalledTimes(1);

      montar({ aoFechar: novo, podeFechar: false, children: TRES_BOTOES });
      teclar("Escape");
      expect(novo).toHaveBeenCalledTimes(1);
    });
  });

  describe("Tab", () => {
    it("camada sem nenhum campo focável: o Tab é cancelado e o foco fica na raiz, venha de onde vier", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: <p>só texto</p> });
      expect(document.activeElement).toBe(camada());

      // Foco de fora da camada (a tela de trás): o Tab traz a raiz de volta.
      origem.focus();
      const evento = teclar("Tab");
      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(camada());

      const volta = teclar("Tab", { shiftKey: true });
      expect(volta.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(camada());
    });

    it("com o foco na própria raiz: Tab vai ao primeiro e Shift+Tab ao último", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: TRES_BOTOES });
      expect(document.activeElement).toBe(camada());

      const evento = teclar("Tab");
      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(botao("um"));

      camada()?.focus();
      const volta = teclar("Tab", { shiftKey: true });
      expect(volta.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(botao("tres"));
    });

    it("com o foco FORA da camada: Tab vai ao primeiro e Shift+Tab ao último", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: TRES_BOTOES });

      origem.focus();
      teclar("Tab");
      expect(document.activeElement).toBe(botao("um"));

      origem.focus();
      teclar("Tab", { shiftKey: true });
      expect(document.activeElement).toBe(botao("tres"));
    });

    it("nas pontas a camada dá a volta: Shift+Tab no primeiro vai ao último, Tab no último vai ao primeiro", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: TRES_BOTOES });

      botao("um").focus();
      const volta = teclar("Tab", { shiftKey: true });
      expect(volta.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(botao("tres"));

      const frente = teclar("Tab");
      expect(frente.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(botao("um"));
    });

    it("com o foco no MEIO da lista o navegador anda sozinho: o Tab não é cancelado", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: TRES_BOTOES });
      botao("dois").focus();

      expect(teclar("Tab").defaultPrevented).toBe(false);
      expect(teclar("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(botao("dois"));
    });

    it("no primeiro com Tab e no último com Shift+Tab o navegador também anda sozinho", () => {
      montar({ aoFechar: vi.fn<() => void>(), children: TRES_BOTOES });

      botao("um").focus();
      expect(teclar("Tab").defaultPrevented).toBe(false);
      botao("tres").focus();
      expect(teclar("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    });

    it("só focável de verdade entra na lista: tabindex=0 entra; tabindex=-1 e botão desabilitado, não", () => {
      montar({
        aoFechar: vi.fn<() => void>(),
        children: (
          <>
            <button type="button">um</button>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- o ponto do teste: tabindex=0 conta como focável */}
            <span tabIndex={0} data-testid="ultimo-de-verdade">
              foco por tabindex
            </span>
            <div tabIndex={-1}>so por script</div>
            <button type="button" disabled>
              desligado
            </button>
          </>
        ),
      });
      const ultimo = document.body.querySelector<HTMLElement>(
        '[data-testid="ultimo-de-verdade"]',
      );
      ultimo?.focus();
      expect(document.activeElement).toBe(ultimo);

      // O último "de verdade" é o span: dele o Tab volta ao primeiro.
      const evento = teclar("Tab");
      expect(evento.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(botao("um"));
    });

    it("outras teclas passam intactas, mesmo no último campo", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, children: TRES_BOTOES });
      botao("tres").focus();

      const evento = teclar("a");
      expect(evento.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(botao("tres"));
      expect(aoFechar).not.toHaveBeenCalled();
    });
  });

  describe("ativa=false", () => {
    it("camada desligada: sem foco ao abrir, sem Esc e sem Tab preso", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, ativa: false, children: TRES_BOTOES });

      expect(document.activeElement).toBe(origem);
      expect(teclar("Escape").defaultPrevented).toBe(false);
      expect(aoFechar).not.toHaveBeenCalled();
      expect(teclar("Tab").defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(origem);
    });

    it("ligada e depois desligada: o foco volta a quem abriu e o Esc solta", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, ativa: true, children: TRES_BOTOES });
      expect(document.activeElement).toBe(camada());

      montar({ aoFechar, ativa: false, children: TRES_BOTOES });
      expect(document.activeElement).toBe(origem);
      expect(teclar("Escape").defaultPrevented).toBe(false);
      expect(aoFechar).not.toHaveBeenCalled();
    });

    it("quem abriu saiu da tela antes de fechar: voltar o foco não quebra nada", () => {
      const aoFechar = vi.fn<() => void>();
      montar({ aoFechar, children: TRES_BOTOES });
      origem.remove();
      expect(() => montar({ aoFechar, ativa: false })).not.toThrow();
      document.body.appendChild(origem);
    });
  });
});
