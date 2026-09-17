// @vitest-environment jsdom
//
// Trilha 4 (#104), ATUALIZADO pela 20261063000000 (o donut passou a
// ratear `marketplace_orders.total` por categoria): o centro do donut e
// o card "Volume Total" (SUM de `marketplace_orders.total`) agora somam
// o MESMO dinheiro — a legenda que dizia "pode divergir" ficou obsoleta
// no dia em que a migration 20261063 fechou a divergência de cupom e
// frete. Este teste prova que a legenda ATUALIZADA (o total bate com o
// Volume Total) aparece no bloco de dados de verdade (não nos ramos de
// erro/vazio/esqueleto, que não têm total para comparar). O guardião
// frase-a-frase da nota vive em
// grafico-de-categorias-nao-promete-frete.test.tsx; este cobre a
// existência da legenda no ramo de dados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/admin-orders-payment-filter.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarChartPronto(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}

describe("StrategicIntelligenceBlocks — legenda do total do donut (#104, pós-20261063)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverPolyfill);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
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

  it("explica que o total do donut é o mesmo dinheiro do Volume Total", async () => {
    const { StrategicIntelligenceBlocks } = await import(
      "@/components/admin/dashboard/StrategicIntelligenceBlocks"
    );

    act(() => {
      raiz.render(
        <StrategicIntelligenceBlocks
          categoryData={[{ name: "Roupas", value: 100 }]}
          loading={false}
        />,
      );
    });
    await esperarChartPronto();
    act(() => {});

    expect(hospedeiro.textContent).toMatch(
      /mesmo dinheiro do card "volume total"/i,
    );
    expect(hospedeiro.textContent).toMatch(/volume total/i);
  });
});
