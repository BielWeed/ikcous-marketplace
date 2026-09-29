// @vitest-environment jsdom
//
// Causa raiz do achado do dono (28/09/2026): o Dashboard CRM rolava para o
// lado no celular. Medição com Playwright (réplica do contêiner de rolagem
// `AdminArea.tsx:~569`) achou a origem: o enfeite decorativo de
// TopProductsList.tsx ("Top 5 produtos mais lucrativos") era `absolute
// -right-20 -top-20` mas morava FORA do cartão com `overflow-hidden` — um
// irmão anterior, dentro de um `<div className="relative">` sem clip
// nenhum. Com `overflow-y: auto` no contêiner de rolagem do AdminArea, o
// CSS acopla `overflow-x: auto` (interdependência dos dois eixos) e o
// transbordo de 64px virava rolagem lateral na tela inteira.
//
// O conserto moveu o enfeite para DENTRO do cartão (mesmo padrão já usado
// em StrategicIntelligenceBlocks.tsx e OperationalPerformanceChart.tsx,
// que a mesma medição confirmou já estarem corretos — 0 transbordo neles).
//
// jsdom não faz layout de verdade, então este teste prova a causa raiz de
// um jeito que não depende de layout: sobe a árvore do DOM a partir do
// enfeite e confere que existe um ancestral com `overflow-hidden` antes de
// sair do componente. Sem o conserto, esse ancestral não existe — este
// teste falha pelo motivo certo. A prova de layout de verdade (scrollWidth
// === clientWidth) foi feita à parte com Playwright e está colada no
// relatório desta tarefa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom não implementa IntersectionObserver — LazyImage (usado pela
// miniatura de cada produto) cria um a cada montagem, mesmo padrão de
// tests/front/painel-nao-chama-faturamento-de-lucro.test.tsx.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function statsComUmProduto() {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts: [
      { id: "p1", name: "Produto 1", quantity: 5, total: 100, image: "" },
    ],
    inventoryAlerts: 0,
  } as any;
}

describe("TopProductsList — o enfeite decorativo não vaza para fora do cartão", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("o div com deslocamento negativo (-right-20 -top-20) mora dentro de um ancestral com overflow-hidden", async () => {
    const { TopProductsList } = await import(
      "@/components/admin/dashboard/TopProductsList"
    );
    act(() => {
      raiz.render(
        <TopProductsList
          stats={statsComUmProduto()}
          loading={false}
          onNavigate={() => {}}
        />,
      );
    });

    const enfeite = Array.from(hospedeiro.querySelectorAll("div")).find(
      (el) =>
        el.className.includes("-right-20") && el.className.includes("-top-20"),
    );
    expect(enfeite).toBeTruthy();

    // Sobe a árvore do DOM a partir do enfeite: tem que achar um ancestral
    // com overflow-hidden ANTES de sair de `hospedeiro` — senão o enfeite
    // não está contido por nada (a causa raiz do achado 28/09/2026).
    let no: HTMLElement | null = enfeite!.parentElement;
    let contido = false;
    while (no && no !== hospedeiro) {
      if (no.className.includes("overflow-hidden")) {
        contido = true;
        break;
      }
      no = no.parentElement;
    }
    expect(contido).toBe(true);
  });
});
