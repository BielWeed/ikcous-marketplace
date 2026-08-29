// @vitest-environment jsdom
//
// Trilha 4 (#104), ATUALIZADO pela 20261003000000 (frete deixou de ser
// categoria): o centro do donut (soma de `get_category_analytics` — SÓ
// itens, SEM subtrair desconto e SEM frete) e o card "Volume Total"
// (SUM de `marketplace_orders.total`, JÁ líquido de desconto — e COM
// frete) podem divergir por dois motivos: cupom e frete. A decisão do
// brief é não mexer em cálculo — só explicitar a diferença na UI com uma
// legenda. Este teste prova que a legenda aparece no bloco de dados de
// verdade (não nos ramos de erro/vazio/esqueleto, que não têm total para
// comparar). O guardião frase-a-frase da nota vive em
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

describe("StrategicIntelligenceBlocks — legenda da divergência de totais (#104)", () => {
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

  it("explica que o total do donut é itens sem frete — pode divergir do Volume Total (com frete)", async () => {
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

    expect(hospedeiro.textContent).toMatch(/sem desconto e sem frete/i);
    expect(hospedeiro.textContent).toMatch(/volume total/i);
  });
});
