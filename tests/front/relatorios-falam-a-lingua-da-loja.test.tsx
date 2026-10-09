// @vitest-environment jsdom
//
// Painel simples, G1: os Relatórios (CRM) e os blocos que a Visão geral monta
// falam a língua da loja (glossário: src/lib/glossario-do-painel.ts).
//   (a) cada segmento de cliente tem rótulo e descrição sem jargão, e os seis
//       rótulos que o glossário renomeou batem com `termoDoLojista()`;
//   (b) as abas Visão geral e Canais, a ajuda e os gráficos, com dados de
//       verdade, não mostram "Ticket", "LTV" nem "ROI";
//   (c) o Início diz "valor médio por venda".
// Só TEXTO muda: os slugs (`campeoes`…) vêm de `crm_visao` e seguem iguais.
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import { infoDoSegmento, lerPainelInicio, lerVisaoDoCrm } from "@/lib/crm";
import {
  padroesProibidosDoPainel,
  termoDoLojista,
} from "@/lib/glossario-do-painel";
import type { SegmentoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEGMENTOS: readonly SegmentoCrm[] = [
  "campeoes",
  "leais",
  "ativos",
  "novos",
  "promissores",
  "precisam_atencao",
  "quase_dormindo",
  "em_risco",
  "nao_pode_perder",
  "hibernando",
  "pediu_nao_pagou",
  "nunca_comprou",
];

const JARGAO_DO_CRM = /ticket|\bLTV\b|\bROI\b|\bRFM\b/i;

const VISAO = lerVisaoDoCrm({
  kpis: {
    receita: 5000,
    receita_anterior: 4000,
    pedidos: 40,
    pedidos_anterior: 50,
    ticket_medio: 125,
    ticket_medio_anterior: 80,
    clientes_compradores: 30,
    clientes_novos: 6,
    taxa_recompra: 0.333,
    receita_recorrente_pct: 0.58,
    ltv_medio: 410,
    receita_em_risco: 2200,
    taxa_devolucao: 0.025,
  },
  canais: [
    { canal: "presencial", receita: 2000, pedidos: 25, ticket_medio: 80 },
    { canal: "online", receita: 3000, pedidos: 15, ticket_medio: 200 },
  ],
  formas: [
    { forma: "pix", receita: 3500, pedidos: 20 },
    { forma: "dinheiro", receita: 1500, pedidos: 20 },
  ],
  funil: {},
  pipeline: [],
  segmentos: [],
});

describe("Relatórios — rótulos dos segmentos (infoDoSegmento)", () => {
  it("nenhum rótulo nem descrição casa um termo proibido do glossário", () => {
    for (const segmento of SEGMENTOS) {
      const { rotulo, descricao } = infoDoSegmento(segmento);
      for (const padrao of padroesProibidosDoPainel()) {
        expect(rotulo, `${segmento}: rótulo`).not.toMatch(padrao);
        expect(descricao, `${segmento}: descrição`).not.toMatch(padrao);
      }
    }
  });

  it("os seis rótulos renomeados vêm do glossário e os slugs não mudam", () => {
    expect(infoDoSegmento("campeoes").rotulo).toBe(termoDoLojista("Campeões"));
    expect(infoDoSegmento("leais").rotulo).toBe(termoDoLojista("Leais"));
    expect(infoDoSegmento("quase_dormindo").rotulo).toBe(
      termoDoLojista("Quase dormindo"),
    );
    expect(infoDoSegmento("em_risco").rotulo).toBe(termoDoLojista("Em risco"));
    expect(infoDoSegmento("nao_pode_perder").rotulo).toBe(
      termoDoLojista("Não pode perder"),
    );
    expect(infoDoSegmento("hibernando").rotulo).toBe(
      termoDoLojista("Hibernando"),
    );
    // Quase dormindo virou "Sumindo": a descrição não repete a palavra.
    expect(infoDoSegmento("quase_dormindo").descricao).not.toMatch(/sumindo/i);
    // Cada slug segue tendo rótulo, descrição e tom.
    for (const segmento of SEGMENTOS) {
      const info = infoDoSegmento(segmento);
      expect(info.rotulo.length).toBeGreaterThan(0);
      expect(info.descricao.length).toBeGreaterThan(0);
      expect(info.tom).toBeTruthy();
    }
  });
});

describe("Relatórios — telas sem jargão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  it("Visão geral: 'Valor médio por venda' e 'Total já comprado', sem Ticket/LTV/ROI", async () => {
    expect(VISAO).not.toBeNull();
    await act(async () => {
      raiz.render(
        <VisaoGeralDoCrm
          visao={VISAO}
          carregando={false}
          comparacao="vs. mês anterior"
          classico={
            {
              stats: {
                today: {
                  revenue: 0,
                  count: 0,
                  pending: 0,
                  revenueTrend: 0,
                  countTrend: 0,
                },
                month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
                executive: {
                  totalRevenue: 300,
                  totalOrders: 3,
                  revenueTrend: 0,
                  ordersTrend: 0,
                  avgTicket: 100,
                  avgTicketTrend: 0,
                  activeCustomers: 0,
                  activeCustomersTrend: 0,
                },
                revenueHistory: [],
                topProducts: [],
                inventoryAlerts: 0,
              },
              categorias: [
                { name: "Roupas", value: 100, avg_ticket: 50, orders: 2 },
              ],
              erro: null,
              erroDeCategoria: null,
              carregando: false,
              carregar: vi.fn(),
            } as never
          }
          active={true}
          onNavigate={vi.fn()}
          aoVerSegmento={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Valor médio por venda");
    expect(texto).toContain("Total já comprado por cliente (média)");
    expect(texto).toContain("Retorno do estoque");
    expect(texto).toMatch(/Valor médio por venda:/);
    expect(texto).not.toMatch(JARGAO_DO_CRM);
    // Os números continuam os mesmos.
    expect(texto).toMatch(/R\$\s125,00/);
    expect(texto).toMatch(/R\$\s410,00/);
  });

  it("Canais: o comparativo e a forma de pagamento falam 'valor médio por venda'", async () => {
    await act(async () => {
      raiz.render(
        <CanaisDoCrm visao={VISAO} carregando={false} onNavigate={vi.fn()} />,
      );
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Valor médio por venda");
    expect(texto).not.toMatch(JARGAO_DO_CRM);
  });

  it("Início: 'valor médio por venda' no resumo do mês", async () => {
    const painel = lerPainelInicio({
      mes: { receita: 1000, pedidos: 10, ticket_medio: 100 },
    });
    await act(async () => {
      raiz.render(
        <NumerosDoMes
          painel={painel}
          carregando={false}
          onNavigate={vi.fn()}
        />,
      );
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("valor médio por venda");
    expect(texto).not.toMatch(/ticket/i);
  });
});
