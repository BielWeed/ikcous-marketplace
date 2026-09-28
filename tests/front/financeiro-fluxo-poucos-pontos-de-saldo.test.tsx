// @vitest-environment jsdom
//
// Revisão independente (achado #3): quando o marco do saldo inicial cai
// perto de hoje — bem provável na loja real, as 3 contas de sistema nascem
// com `saldo_inicial_em` = o dia em que a migration 20261177000000 rodou —
// quase todo dia da janela de 30 dias fica com `saldo: null`. O AreaChart da
// linha do saldo então desenha (no melhor caso) um único ponto: o eixo Y
// vira "R$ 1, R$ 2, R$ 3, R$ 4" (recharts inventando uma escala pra um
// domínio de largura zero) e o painel "Saldo" fica confuso, sem dizer nada.
//
// Regra nova: com MENOS DE 2 pontos de saldo conhecido (`saldo !== null`) na
// janela, o AreaChart nem monta — no lugar dele (mesma altura de rótulo
// "Saldo"), uma frase curta diz a partir de quando o saldo aparece; com
// EXATAMENTE 1 ponto conhecido, mostra esse saldo formatado (sinal e modo
// oculto). O BarChart de entradas/saídas continua de pé, com tooltip
// funcionando — o `syncId` compartilhado não pode quebrar por só ter UM
// gráfico inscrito.
import { FluxoDeCaixaGrafico } from "@/components/admin/financeiro/FluxoDeCaixaGrafico";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { PontoDoFluxo } from "@/lib/financeiro";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const LARGURA = 320;
const ALTURA = 300;

let container: HTMLDivElement;
let root: Root;
let getBoundingClientRectOriginal: typeof Element.prototype.getBoundingClientRect;
let offsetWidthOriginal: PropertyDescriptor | undefined;
let offsetHeightOriginal: PropertyDescriptor | undefined;

function montar(ui: Parameters<Root["render"]>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return container;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  getBoundingClientRectOriginal = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () =>
    ({
      width: LARGURA,
      height: ALTURA,
      top: 0,
      left: 0,
      right: LARGURA,
      bottom: ALTURA,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  offsetWidthOriginal = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  offsetHeightOriginal = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: LARGURA,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: ALTURA,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Element.prototype.getBoundingClientRect = getBoundingClientRectOriginal;
  if (offsetWidthOriginal) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      offsetWidthOriginal,
    );
  }
  if (offsetHeightOriginal) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      offsetHeightOriginal,
    );
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function tooltips(tela: HTMLElement) {
  return tela.querySelectorAll('[data-testid="fluxo-tooltip"]');
}

describe("FluxoDeCaixaGrafico — painel de saldo com poucos pontos conhecidos", () => {
  it("0 pontos com saldo conhecido: sem AreaChart, frase da data do marco, sem 'saldo de hoje', e o BarChart segue com tooltip", () => {
    // Marco depois do fim da janela: todo mundo fica null (a conta só passou
    // a existir "amanhã", do ponto de vista da janela de 30 dias).
    const pontos: readonly PontoDoFluxo[] = [
      { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: null },
      {
        dia: "2026-08-30",
        entradas: 50,
        saidas: 0,
        resultado: 50,
        saldo: null,
      },
    ];
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={pontos}
        carregando={false}
        ativo={true}
        marco="2026-10-05"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Só o BarChart monta — sem par de AreaChart no mesmo syncId.
    const wrappers = tela.querySelectorAll<HTMLElement>(".recharts-wrapper");
    expect(wrappers).toHaveLength(1);

    expect(tela.textContent).toContain("Saldo");
    expect(tela.textContent).toContain(
      "O saldo aparece aqui a partir de 05/10",
    );
    expect(tela.textContent).not.toContain("Saldo de hoje");

    // A nota de baixo não repete a mesma frase — só a dica de ação.
    expect(tela.textContent).toContain(
      "Ajuste o saldo inicial em Contas e categorias",
    );
    const vezesQueApareceAFrase = (
      tela.textContent?.match(/O saldo aparece aqui a partir de/g) ?? []
    ).length;
    expect(vezesQueApareceAFrase).toBe(1);

    // O BarChart sozinho continua respondendo ao toque — syncId sem par não
    // pode quebrar o cursor/tooltip dele.
    act(() => {
      wrappers[0].dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 90,
          clientY: 100,
        }),
      );
    });
    expect(tooltips(tela)).toHaveLength(1);
  });

  it("1 ponto com saldo conhecido: mostra o saldo de hoje formatado (com sinal)", () => {
    const pontos: readonly PontoDoFluxo[] = [
      { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: null },
      {
        dia: "2026-08-30",
        entradas: 0,
        saidas: 50,
        resultado: -50,
        saldo: -50,
      },
    ];
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={pontos}
        carregando={false}
        ativo={true}
        marco="2026-08-30"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(tela.querySelectorAll(".recharts-wrapper")).toHaveLength(1);
    const texto = (tela.textContent ?? "").replace(/\s/g, " ");
    expect(texto).toContain("Saldo de hoje");
    expect(texto).toContain("−R$ 50,00");
  });

  it("1 ponto com saldo conhecido, valores ocultos: mostra 'R$ ••••', nunca o número", () => {
    const pontos: readonly PontoDoFluxo[] = [
      { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: null },
      {
        dia: "2026-08-30",
        entradas: 0,
        saidas: 50,
        resultado: -50,
        saldo: -50,
      },
    ];
    const tela = montar(
      <ContextoValoresOcultos.Provider value={true}>
        <FluxoDeCaixaGrafico
          pontos={pontos}
          carregando={false}
          ativo={true}
          marco="2026-08-30"
        />
      </ContextoValoresOcultos.Provider>,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const texto = tela.textContent ?? "";
    expect(texto).toContain("Saldo de hoje");
    expect(texto).toContain("R$ ••••");
    expect(texto).not.toContain("50,00");
  });

  it("2+ pontos com saldo conhecido: comportamento normal — AreaChart desenha a linha", () => {
    const pontos: readonly PontoDoFluxo[] = [
      { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: null },
      { dia: "2026-08-30", entradas: 50, saidas: 0, resultado: 50, saldo: 50 },
      { dia: "2026-08-31", entradas: 0, saidas: 0, resultado: 0, saldo: 50 },
    ];
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={pontos}
        carregando={false}
        ativo={true}
        marco="2026-08-30"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(tela.querySelectorAll(".recharts-wrapper")).toHaveLength(2);
    expect(tela.textContent).not.toContain("Saldo de hoje");
    expect(tela.textContent).not.toContain("O saldo aparece aqui a partir de");
    // A nota "de sempre" (não a versão curta) segue de pé quando há linha.
    expect(tela.textContent).toContain("O saldo só aparece a partir de 30/08");
  });
});
