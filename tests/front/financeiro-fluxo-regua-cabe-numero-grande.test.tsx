// @vitest-environment jsdom
//
// Fluxo de caixa (Financeiro): a régua da esquerda reservava 56 px, pouco para
// "R$ 12,5 mil" ou "−R$ 1,5 mil" — o número era cortado na borda. Largura 72,
// a mesma do gráfico irmão de Relatórios (OperationalPerformanceChart), nos
// dois gráficos da chave (Saldo e Entradas e saídas): o mesmo eixo serve aos dois.
import { FluxoDeCaixaGrafico } from "@/components/admin/financeiro/FluxoDeCaixaGrafico";
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

// Tamanho fixo que o recharts usa para calcular offset dos eixos e mapear
// posição do mouse → índice do dado (`getMouseInfo`, em
// node_modules/recharts/es6/chart/generateCategoricalChart.js): sem isto,
// jsdom devolve 0×0 (sem layout real) e nenhum ponto nunca fica "em range".
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

describe("FluxoDeCaixaGrafico: a régua de valores cabe 'R$ 12,5 mil'", () => {
  const PONTOS_GRANDES: readonly PontoDoFluxo[] = [
    { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: -1500 },
    {
      dia: "2026-08-30",
      entradas: 12500,
      saidas: 0,
      resultado: 12500,
      saldo: 12500,
    },
  ];

  function larguraDosNumeros(tela: HTMLElement) {
    const textos = [
      ...tela.querySelectorAll<SVGTextElement>(".recharts-yAxis text"),
    ];
    expect(textos.length).toBeGreaterThan(0);
    return textos.map((t) => t.getAttribute("width"));
  }

  it.each(["Saldo", "Entradas e saídas"])(
    "no gráfico %s o eixo Y reserva 72 px",
    (rotulo) => {
      const tela = montar(
        <FluxoDeCaixaGrafico
          pontos={PONTOS_GRANDES}
          carregando={false}
          ativo={true}
          marco={null}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(300);
      });
      if (rotulo !== "Saldo") {
        const botao = [
          ...tela.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
        ].find((b) => (b.textContent ?? "").trim() === rotulo);
        act(() => {
          botao?.click();
        });
        act(() => {
          vi.advanceTimersByTime(300);
        });
      }
      for (const largura of larguraDosNumeros(tela)) {
        expect(largura).toBe("72");
      }
    },
  );
});
