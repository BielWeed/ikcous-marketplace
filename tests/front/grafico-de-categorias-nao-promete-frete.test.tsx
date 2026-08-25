// @vitest-environment jsdom
//
// Item 4 da fila 1935: a nota de rodapé do gráfico de categorias dizia
// "Total deste gráfico = itens + frete, sem desconto" — verdade até a
// migration 20260980000000... até a 20261003000000 REMOVER a linha
// sintética 'Frete' da get_category_analytics. Desde então o total do
// gráfico é SÓ itens: a frase continuou prometendo frete que não está
// mais ali — a frase mentirosa que a 20261003 deixa.
//
// Este teste guarda o par frase x migration: a nota tem que dizer que o
// total é SEM frete (verdade desde a 20261003) e não pode afirmar
// "itens + frete" (mentira desde então). Par completo: a metade RPC é a
// ficha por consulta no cabeçalho da própria migration.
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

describe("nota do gráfico de categorias (par com a 20261003000000)", () => {
  it("total do gráfico é declarado SEM frete — nunca 'itens + frete'", async () => {
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

      // SUJEITO AMARRADO AO PREDICADO (revisao 2350: "sem frete" solto no
      // textContent inteiro casa na cláusula ERRADA — o mutante que move a
      // frase para o Volume Total passava). A nota é localizada pelo seu
      // sujeito ("Total deste gráfico") e as DUAS cláusulas conferidas
      // dentro dela.
      const notas = Array.from(
        hospedeiro.querySelectorAll("p"),
      ).map((p) => p.textContent ?? "");
      const nota = notas.find((tx) => tx.includes("Total deste gráfico"));
      expect(nota).toBeDefined();

      // Cláusula do GRAFICO: itens, sem desconto E SEM FRETE — a frase
      // inteira, amarrada: mutante que solta o "sem frete" daqui cai.
      expect(nota).toContain("itens, sem desconto e sem frete");

      // Cláusula do VOLUME TOTAL: COM frete (o oposto, na mesma nota).
      expect(nota).toContain("com frete");
      expect(nota).not.toContain("itens + frete");
    } finally {
      vi.useRealTimers();
    }
  });
});
