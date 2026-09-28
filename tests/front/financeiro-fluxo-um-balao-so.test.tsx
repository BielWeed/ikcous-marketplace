// @vitest-environment jsdom
//
// Pedido do Gabriel (Financeiro, 27/09/2026), com print do celular: no
// cartão "Fluxo de caixa — últimos 30 dias", tocar no gráfico mostra DOIS
// balões IGUAIS, um em cima do outro — `FluxoDeCaixaGrafico.tsx` empilha um
// AreaChart (saldo) e um BarChart (entradas/saídas) com o MESMO
// `syncId="fin-fluxo"`, e os DOIS têm `<Tooltip content={<ConteudoDoTooltip/>}>`:
// o sync ativa o tooltip nos dois gráficos ao mesmo tempo.
//
// Achado do coordenador no mesmo print: o balão mostra "Saldo ao fim do dia
// R$ 187,40" SEM o sinal de menos, mesmo com a linha desenhada abaixo de
// zero no eixo — `ConteudoDoTooltip` chamava `formatarBRL`, que sempre
// devolve o valor ABSOLUTO (é assim que a função é usada nas linhas de
// entrada/saída, que já vêm sem sinal; para o saldo, que pode ser negativo,
// isso apaga o sinal).
//
// Este teste dispara o evento de mouse que o recharts usa para ativar o
// tooltip (mousemove no `.recharts-wrapper`, com `getBoundingClientRect` e
// `offsetWidth/Height` estabilizados — jsdom não faz layout) e prova as duas
// coisas juntas: só UM balão aparece, e ele escreve "−R$ 187,40" (sinal
// tipográfico U+2212), não "R$ 187,40".
//
// Ajuste pedido pelo coordenador depois da 1ª revisão: aquele −R$ 187,40
// nunca foi um saldo real — é a reconstrução "hoje − Σ depois" andando para
// trás de um marco que `fin__saldos` respeita e o front não respeitava (o
// saldo de uma conta só conta movimento com `data >= saldo_inicial_em`,
// migration 20261177000000, função `fin__saldos`). `serieDoFluxoDeCaixa`
// agora marca dias antes desse marco com `saldo: null`; o teste abaixo prova
// que o balão, nesse caso, mostra "—" em vez de inventar um número.
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

// Dois dias: o mais antigo tem o saldo reconstruído NEGATIVO (o caso do
// print — "Sábado, 29 de agosto", saldo −187,40) e nenhum movimento nesse
// dia; o dia seguinte é quem recebeu o PIX de R$187,40 (senão o componente
// mostra o estado vazio "Nenhum dinheiro entrou ou saiu").
const PONTOS: readonly PontoDoFluxo[] = [
  { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: -187.4 },
  {
    dia: "2026-08-30",
    entradas: 187.4,
    saidas: 0,
    resultado: 187.4,
    saldo: 0,
  },
];

function tooltips(tela: HTMLElement) {
  return tela.querySelectorAll('[data-testid="fluxo-tooltip"]');
}

describe("FluxoDeCaixaGrafico — um balão só por toque, com o sinal certo", () => {
  it("antes de tocar, nenhum balão aparece", () => {
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={PONTOS}
        carregando={false}
        ativo={true}
        marco={null}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tooltips(tela)).toHaveLength(0);
  });

  it("ao tocar no gráfico, aparece SÓ UM balão — e ele escreve o saldo negativo com o sinal −", () => {
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={PONTOS}
        carregando={false}
        ativo={true}
        marco={null}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const graficos = tela.querySelectorAll<HTMLElement>(".recharts-wrapper");
    expect(graficos).toHaveLength(2);
    // O gráfico de baixo (barras de entrada/saída) — largura 320, eixo Y
    // reserva 56px à esquerda, margem direita 8px: 2 dias dividem os
    // (320−56−8)=256px restantes em 128px cada. clientX=90 cai na 1ª banda
    // (56–184), o dia de 29/08 (saldo −187,40).
    const graficoDeBaixo = graficos[1];

    act(() => {
      graficoDeBaixo.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 90,
          clientY: 100,
        }),
      );
    });

    const balões = tooltips(tela);
    // O defeito relatado: os DOIS gráficos (mesmo syncId) ativam o tooltip
    // juntos, e cada um tem seu próprio `<Tooltip content={...}>` — dois
    // balões iguais, um em cima do outro.
    expect(balões).toHaveLength(1);

    // O Intl põe espaço inseparável depois de "R$" — mesmo tratamento de
    // tests/front/financeiro-lib.test.ts (`semNbsp`).
    const texto = (balões[0]?.textContent ?? "").replace(/\s/g, " ");
    expect(texto).toContain("Sábado, 29 de agosto");
    // Sinal tipográfico U+2212 (SINAL_DE_MENOS de src/lib/financeiro.ts),
    // não o hífen comum nem "R$ 187,40" sem sinal nenhum.
    expect(texto).toContain("−R$ 187,40");
    expect(texto).not.toMatch(/(?<!−)R\$ 187,40/);
  });

  it("num dia ANTES do marco (saldo: null), o balão mostra “—” e nunca inventa o −R$ 187,40", () => {
    // 3 dias, com os 2 dias de saldo conhecido DIFERENTES entre si (0 e
    // −10): com só 1 saldo conhecido, ou 2+ TODOS IGUAIS, o AreaChart nem
    // monta (outros cenários, testados à parte em
    // "painel de saldo com poucos pontos conhecidos" e
    // "...quando todos os pontos conhecidos são IGUAIS") — este teste quer
    // o caminho NORMAL (linha do saldo desenhada), só com um dia ANTES do
    // marco no meio.
    const antesDoMarco: readonly PontoDoFluxo[] = [
      { dia: "2026-08-29", entradas: 0, saidas: 0, resultado: 0, saldo: null },
      {
        dia: "2026-08-30",
        entradas: 187.4,
        saidas: 0,
        resultado: 187.4,
        saldo: 0,
      },
      {
        dia: "2026-08-31",
        entradas: 0,
        saidas: 10,
        resultado: -10,
        saldo: -10,
      },
    ];
    const tela = montar(
      <FluxoDeCaixaGrafico
        pontos={antesDoMarco}
        carregando={false}
        ativo={true}
        marco="2026-08-30"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const graficoDeBaixo =
      tela.querySelectorAll<HTMLElement>(".recharts-wrapper")[1];
    act(() => {
      graficoDeBaixo.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 90,
          clientY: 100,
        }),
      );
    });

    const balões = tooltips(tela);
    expect(balões).toHaveLength(1);
    const texto = (balões[0]?.textContent ?? "").replace(/\s/g, " ");
    expect(texto).toContain("Sábado, 29 de agosto");
    expect(texto).toContain("—");
    expect(texto).not.toContain("187,40");

    // Revisão independente (contraste): o "—" do balão estava em
    // text-zinc-500 sobre o fundo do balão (#09090b/95%) — ~4,12:1, abaixo de
    // AA (4,5:1) para texto de 11px. text-zinc-400 é o mesmo tom usado no
    // resto do cartão (rótulos "Saldo"/"Entradas e saídas", a nota abaixo do
    // gráfico) — já medido.
    const spanDoTraco = [...balões[0]!.querySelectorAll("span")].find((el) =>
      (el.textContent ?? "").trim().startsWith("—"),
    );
    expect(spanDoTraco).toBeTruthy();
    expect(spanDoTraco?.className).toContain("text-zinc-400");
    expect(spanDoTraco?.className).not.toContain("text-zinc-500");
  });

  it("na tabela 'Ver os números em tabela', o “—” de um dia sem saldo conhecido também usa zinc-400", () => {
    // Dia COM movimento (entra na tabela — ela só lista `diasComMovimento`)
    // mas ANTES do marco: acontece quando um lançamento antigo é importado
    // depois de a conta já ter um saldo inicial mais recente.
    const pontos: readonly PontoDoFluxo[] = [
      {
        dia: "2026-08-29",
        entradas: 50,
        saidas: 0,
        resultado: 50,
        saldo: null,
      },
      { dia: "2026-08-30", entradas: 0, saidas: 0, resultado: 0, saldo: 50 },
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

    const linhas = [...tela.querySelectorAll("table tbody tr")];
    const linhaDoDia = linhas.find((tr) =>
      (tr.textContent ?? "").includes("29/08"),
    );
    expect(linhaDoDia).toBeTruthy();
    const spanDoTraco = [
      ...(linhaDoDia as HTMLElement).querySelectorAll("span"),
    ].find((el) => (el.textContent ?? "").trim() === "—");
    expect(spanDoTraco).toBeTruthy();
    expect(spanDoTraco?.className).toContain("text-zinc-400");
    expect(spanDoTraco?.className).not.toContain("text-zinc-500");
  });
});
