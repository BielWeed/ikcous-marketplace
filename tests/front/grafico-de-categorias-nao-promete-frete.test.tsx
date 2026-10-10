// @vitest-environment jsdom
//
// Item 4 da fila 1935: a nota de rodapé do gráfico de categorias dizia
// "Total deste gráfico = itens + frete, sem desconto" — verdade enquanto
// a get_category_analytics fazia UNION ALL da linha sintética 'Frete'.
// A migration 20261003000000 REMOVEU essa linha, e a nota passou a dizer
// "itens, sem desconto e sem frete — pode divergir do Volume Total". Isso
// também deixou de ser verdade: a migration 20261063000000 reescreveu
// get_category_analytics para RATEAR `marketplace_orders.total` (já
// líquido de cupom, com frete) proporcionalmente por categoria — o donut
// passou a somar o MESMO dinheiro que o card "Volume Total" somava.
//
// 28/09/2026: o card "Volume Total" (carrossel "Métricas principais",
// KpiSummaryCards) saiu da tela — duplicava os 8 números do período de
// cima. A nota não pode mais apontar para um card que não existe: passou a
// descrever o número direto ("a receita total da loja").
//
// Este teste guarda o par frase x migration: a nota tem que dizer que o
// total é a receita total da loja (verdade desde a 20261063) e não pode
// mais afirmar "itens + frete" nem "sem desconto e sem frete" (as duas
// mentiras que ficaram para trás) nem citar o card removido. Par completo:
// a metade RPC é a ficha por consulta no cabeçalho da própria migration
// 20261063000000.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StrategicIntelligenceBlocks } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function stubsDeBrowser() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  stubsDeBrowser();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("nota do gráfico de categorias (par com a 20261063000000)", () => {
  it("total do gráfico é declarado como a receita total da loja — nunca 'sem frete' nem 'Volume Total'", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        raiz.render(
          <StrategicIntelligenceBlocks
            categoryData={[{ name: "brinquedo", value: 253.1 }]}
            loading={false}
            active={true}
          />,
        );
      });
      // O componente só sai do esqueleto depois de um setTimeout(180ms)
      // de "chart ready" — avançar o relógio é parte do arranjo.
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      // SUJEITO AMARRADO AO PREDICADO (revisao 2350: uma frase solta no
      // textContent inteiro casa na cláusula ERRADA — um mutante que move a
      // cláusula para outra frase da tela passava). A nota é localizada pelo
      // seu sujeito ("Total deste gráfico") e as cláusulas conferidas dentro
      // dela.
      const notas = Array.from(hospedeiro.querySelectorAll("p")).map(
        (p) => p.textContent ?? "",
      );
      const nota = notas.find((tx) => tx.includes("Total deste gráfico"));
      expect(nota).toBeDefined();

      // Cláusula atual (pós-20261063, sem o card removido em 28/09/2026):
      // o donut é a receita total da loja — rateada por categoria, líquida
      // de desconto e COM frete.
      expect(nota).toContain("a receita total da loja");
      expect(nota).toContain("líquida de desconto e com frete");

      // Regressão: as duas frases antigas (uma por migration) não podem
      // voltar — a primeira mentia sobre frete, a segunda sobre desconto
      // e frete — nem a referência ao card "Volume Total", que saiu da
      // tela e não pode mais ser prometido aqui.
      expect(nota).not.toContain("itens + frete");
      expect(nota).not.toContain("sem desconto e sem frete");
      expect(nota).not.toContain("Volume Total");
    } finally {
      vi.useRealTimers();
    }
  });
});
